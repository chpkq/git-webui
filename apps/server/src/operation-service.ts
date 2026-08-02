import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  GitWebUiError,
  type Operation,
  type OperationType,
  type PreflightSnapshot,
  type UserRole,
} from '@git-webui/shared';
import { redactSensitiveText, type GitProvider } from '@git-webui/git-core';
import type { OperationStore } from './operation-store.js';
import type { RepositoryService } from './repository-service.js';

export interface OperationUpdatedEvent {
  type: 'operation.updated';
  operation: Operation;
}

type OperationListener = (event: OperationUpdatedEvent) => void;

class RepositoryQueue {
  private readonly tails = new Map<string, Promise<void>>();

  public async run<T>(repositoryId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(repositoryId) ?? Promise.resolve();
    let resolveTail: (() => void) | undefined;
    const tail = new Promise<void>((resolve) => {
      resolveTail = resolve;
    });
    this.tails.set(repositoryId, tail);
    await previous.catch(() => undefined);
    try {
      return await task();
    } finally {
      resolveTail?.();
      if (this.tails.get(repositoryId) === tail) this.tails.delete(repositoryId);
    }
  }
}

export class OperationService {
  private readonly queue = new RepositoryQueue();

  private readonly events = new EventEmitter();

  private readonly controllers = new Map<string, AbortController>();

  private readonly cancelled = new Set<string>();

  public constructor(
    private readonly repositoryService: RepositoryService,
    private readonly gitProvider: GitProvider,
    private readonly store: OperationStore,
    private readonly role: UserRole = 'admin',
  ) {}

  public subscribe(listener: OperationListener): () => void {
    this.events.on('updated', listener);
    return () => this.events.off('updated', listener);
  }

  public get(id: string): Operation {
    return this.store.get(id);
  }

  public list(repositoryId?: string): Operation[] {
    return this.store.list(repositoryId);
  }

  public cancel(id: string): Operation {
    this.assertCanWrite();
    const operation = this.store.get(id);
    if (
      operation.status === 'success' ||
      operation.status === 'failed' ||
      operation.status === 'conflict' ||
      operation.status === 'cancelled'
    ) {
      return operation;
    }
    if (operation.type !== 'fetch') {
      throw new GitWebUiError('OPERATION_BUSY', '只有 Fetch 操作支持安全取消。');
    }
    const controller = this.controllers.get(id);
    if (controller === undefined) {
      throw new GitWebUiError('OPERATION_BUSY', '操作当前不可取消，请等待其完成。');
    }
    this.cancelled.add(id);
    controller.abort();
    return this.store.get(id);
  }

  public async runFileOperation(
    repositoryId: string,
    type: Extract<OperationType, 'stage' | 'unstage'>,
    paths: readonly string[],
    actor = 'local-user',
  ): Promise<Operation> {
    this.assertCanWrite();
    const repository = await this.repositoryService.getValidated(repositoryId);
    this.repositoryService.beginOperation(repositoryId);
    let operation: Operation;
    try {
      operation = this.store.create({
        id: randomUUID(),
        repositoryId,
        type,
        target: sanitizeTarget({ paths: [...paths] }),
      });
    } catch (error) {
      this.repositoryService.endOperation(repositoryId);
      throw error;
    }
    this.publish(operation);
    try {
      const preflight = await this.createPreflight(repository.path, paths);
      this.publish(this.store.setPreflight(operation.id, preflight));
      this.assertPreflightReady(preflight);
      const completed = await this.queue.run(repositoryId, async () => {
        const running = this.store.setRunning(operation.id);
        this.publish(running);
        try {
          const currentPreflight = await this.createPreflight(repository.path, paths);
          this.assertPreflightStable(preflight, currentPreflight);
          this.assertPreflightReady(currentPreflight);
          if (type === 'stage') await this.gitProvider.stage(repository.path, paths);
          else await this.gitProvider.unstage(repository.path, paths);
          const status = await this.repositoryService.getStatus(repositoryId);
          const success = this.store.setFinished(operation.id, 'success', {
            head: status.status.head,
            branch: status.status.branch,
            remaining: status.status.entries.length,
          });
          this.store.appendAudit({
            operationId: success.id,
            repositoryId,
            actor,
            action: type,
            target: success.target,
            result: 'success',
          });
          this.publish(success);
          return success;
        } catch (error) {
          const mapped = toOperationError(error);
          const status = mapped.code === 'CONFLICT' ? 'conflict' : 'failed';
          const failed = this.store.setFinished(operation.id, status, undefined, mapped);
          this.store.appendAudit({
            operationId: failed.id,
            repositoryId,
            actor,
            action: type,
            target: failed.target,
            result: mapped.code,
          });
          this.publish(failed);
          return failed;
        }
      });
      return completed;
    } catch (error) {
      const mapped = toOperationError(error);
      const failed = this.store.setFinished(operation.id, 'failed', undefined, mapped);
      this.store.appendAudit({
        operationId: failed.id,
        repositoryId,
        actor,
        action: type,
        target: failed.target,
        result: mapped.code,
      });
      this.publish(failed);
      return failed;
    } finally {
      this.repositoryService.endOperation(repositoryId);
    }
  }

  public async runRemoteOperation(
    repositoryId: string,
    type: Extract<OperationType, 'fetch' | 'pull' | 'push'>,
    target: Record<string, unknown>,
    actor = 'local-user',
  ): Promise<Operation> {
    this.assertCanWrite();
    const repository = await this.repositoryService.getValidated(repositoryId);
    const safeTarget = sanitizeTarget(target);
    this.repositoryService.beginOperation(repositoryId);
    let operation: Operation;
    try {
      operation = this.store.create({
        id: randomUUID(),
        repositoryId,
        type,
        target: safeTarget,
      });
    } catch (error) {
      this.repositoryService.endOperation(repositoryId);
      throw error;
    }
    this.publish(operation);
    const requireClean = type === 'pull';
    const controller = new AbortController();
    this.controllers.set(operation.id, controller);
    try {
      const preflight = await this.createPreflight(repository.path);
      this.publish(this.store.setPreflight(operation.id, preflight));
      this.throwIfCancelled(operation.id);
      this.assertPreflightReady(preflight, requireClean);
      if (type === 'pull' && preflight.upstream === null) {
        throw new GitWebUiError('NO_UPSTREAM', '当前分支没有设置 upstream，不能执行 Pull。');
      }
      return await this.queue.run(repositoryId, async () => {
        this.publish(this.store.setRunning(operation.id));
        try {
          this.throwIfCancelled(operation.id);
          const currentPreflight = await this.createPreflight(repository.path);
          this.assertPreflightStable(preflight, currentPreflight);
          this.assertPreflightReady(currentPreflight, requireClean);
          const reportProgress = (text: string): void => {
            const safeText = redactSensitiveText(text);
            if (safeText === '') return;
            this.publish(
              this.store.setProgress(operation.id, {
                text: safeText.slice(-1000),
                percent: parseProgressPercent(safeText),
              }),
            );
          };
          if (type === 'fetch') {
            await this.gitProvider.fetchAllPrune(
              repository.path,
              reportProgress,
              controller.signal,
            );
          } else if (type === 'pull') {
            await this.gitProvider.pullFastForwardOnly(
              repository.path,
              reportProgress,
              controller.signal,
            );
          } else {
            const remote = readStringTarget(safeTarget, 'remote');
            const branch = readStringTarget(safeTarget, 'branch');
            await this.gitProvider.pushExplicit(
              repository.path,
              remote,
              branch,
              safeTarget.setUpstream === true,
              reportProgress,
              controller.signal,
            );
          }
          const status = await this.repositoryService.getStatus(repositoryId);
          const success = this.store.setFinished(operation.id, 'success', {
            head: status.status.head,
            branch: status.status.branch,
            upstream: status.status.upstream,
          });
          this.store.appendAudit({
            operationId: success.id,
            repositoryId,
            actor,
            action: type,
            target: success.target,
            result: 'success',
          });
          this.publish(success);
          return success;
        } catch (error) {
          return this.finishFailure(operation.id, repositoryId, actor, type, error);
        }
      });
    } catch (error) {
      return this.finishFailure(operation.id, repositoryId, actor, type, error);
    } finally {
      this.controllers.delete(operation.id);
      this.cancelled.delete(operation.id);
      this.repositoryService.endOperation(repositoryId);
    }
  }

  public async runManagementOperation(
    repositoryId: string,
    type: Extract<
      OperationType,
      | 'remote-add'
      | 'remote-set-url'
      | 'remote-remove'
      | 'branch-create'
      | 'branch-switch'
      | 'branch-rename'
      | 'branch-delete'
      | 'branch-set-upstream'
    >,
    target: Record<string, unknown>,
    executor: (repositoryPath: string, onProgress: (text: string) => void) => Promise<void>,
    requireClean = false,
    actor = 'local-user',
  ): Promise<Operation> {
    this.assertManagementPermission(type);
    const repository = await this.repositoryService.getValidated(repositoryId);
    this.repositoryService.beginOperation(repositoryId);
    let operation: Operation;
    try {
      operation = this.store.create({
        id: randomUUID(),
        repositoryId,
        type,
        target: sanitizeTarget(target),
      });
    } catch (error) {
      this.repositoryService.endOperation(repositoryId);
      throw error;
    }
    this.publish(operation);
    try {
      const preflight = await this.createPreflight(repository.path);
      this.publish(this.store.setPreflight(operation.id, preflight));
      this.assertPreflightReady(preflight, requireClean);
      return await this.queue.run(repositoryId, async () => {
        this.publish(this.store.setRunning(operation.id));
        try {
          const currentPreflight = await this.createPreflight(repository.path);
          this.assertPreflightStable(preflight, currentPreflight);
          this.assertPreflightReady(currentPreflight, requireClean);
          await executor(repository.path, (text) => {
            const safeText = redactSensitiveText(text);
            if (safeText === '') return;
            this.publish(
              this.store.setProgress(operation.id, {
                text: safeText.slice(-1000),
                percent: parseProgressPercent(safeText),
              }),
            );
          });
          const status = await this.repositoryService.getStatus(repositoryId);
          const success = this.store.setFinished(operation.id, 'success', {
            head: status.status.head,
            branch: status.status.branch,
          });
          this.store.appendAudit({
            operationId: success.id,
            repositoryId,
            actor,
            action: type,
            target: success.target,
            result: 'success',
          });
          this.publish(success);
          return success;
        } catch (error) {
          return this.finishFailure(operation.id, repositoryId, actor, type, error);
        }
      });
    } catch (error) {
      return this.finishFailure(operation.id, repositoryId, actor, type, error);
    } finally {
      this.repositoryService.endOperation(repositoryId);
    }
  }

  private finishFailure(
    operationId: string,
    repositoryId: string,
    actor: string,
    type: OperationType,
    error: unknown,
  ): Operation {
    const wasCancelled = this.cancelled.has(operationId);
    const mapped = wasCancelled
      ? { code: 'CANCELLED', message: '操作已取消。' }
      : toOperationError(error);
    const status = wasCancelled ? 'cancelled' : mapped.code === 'CONFLICT' ? 'conflict' : 'failed';
    const failed = this.store.setFinished(operationId, status, undefined, mapped);
    this.store.appendAudit({
      operationId: failed.id,
      repositoryId,
      actor,
      action: type,
      target: failed.target,
      result: mapped.code,
    });
    this.publish(failed);
    return failed;
  }

  private async createPreflight(
    repositoryPath: string,
    paths: readonly string[] = [],
  ): Promise<PreflightSnapshot> {
    const status = await this.gitProvider.getStatus(repositoryPath);
    const fingerprints = await this.gitProvider.getStateFingerprints(repositoryPath, paths);
    return {
      head: status.head,
      branch: status.branch,
      upstream: status.upstream,
      ahead: status.ahead,
      behind: status.behind,
      dirty: status.dirty,
      inProgress: status.inProgress,
      ...fingerprints,
    };
  }

  private assertPreflightReady(snapshot: PreflightSnapshot, requireClean = false): void {
    if (snapshot.inProgress.length > 0) {
      throw new GitWebUiError('GIT_IN_PROGRESS', '仓库存在进行中的 Git 状态，不能执行当前操作。', {
        inProgress: snapshot.inProgress,
      });
    }
    if (requireClean && snapshot.dirty) {
      throw new GitWebUiError('DIRTY_WORKTREE', '当前工作区有未提交变更，Pull 已停止。');
    }
  }

  private assertPreflightStable(before: PreflightSnapshot, current: PreflightSnapshot): void {
    if (
      before.head !== current.head ||
      before.branch !== current.branch ||
      before.upstream !== current.upstream ||
      before.ahead !== current.ahead ||
      before.behind !== current.behind ||
      before.dirty !== current.dirty ||
      before.workingTreeFingerprint !== current.workingTreeFingerprint ||
      before.indexFingerprint !== current.indexFingerprint ||
      before.inProgress.join(',') !== current.inProgress.join(',')
    ) {
      throw new GitWebUiError('REPOSITORY_CHANGED', '预检后仓库状态发生变化，请重新确认操作。');
    }
  }

  private publish(operation: Operation): void {
    this.events.emit('updated', {
      type: 'operation.updated',
      operation,
    } satisfies OperationUpdatedEvent);
  }

  private assertCanWrite(): void {
    if (this.role === 'viewer') {
      throw new GitWebUiError('PERMISSION_DENIED', 'Viewer 角色不能执行写操作。');
    }
  }

  private throwIfCancelled(operationId: string): void {
    if (this.cancelled.has(operationId)) {
      throw new GitWebUiError('COMMAND_TIMEOUT', '操作已取消。');
    }
  }

  private assertManagementPermission(
    type: Extract<
      OperationType,
      | 'remote-add'
      | 'remote-set-url'
      | 'remote-remove'
      | 'branch-create'
      | 'branch-switch'
      | 'branch-rename'
      | 'branch-delete'
      | 'branch-set-upstream'
    >,
  ): void {
    this.assertCanWrite();
    if (type.startsWith('remote-') && this.role !== 'admin') {
      throw new GitWebUiError('PERMISSION_DENIED', 'Remote 管理需要 Admin 角色。');
    }
  }
}

const readStringTarget = (target: Record<string, unknown>, key: string): string => {
  const value = target[key];
  if (typeof value !== 'string' || value === '') {
    throw new GitWebUiError('INVALID_REQUEST', `同步操作缺少 ${key} 目标。`);
  }
  return value;
};

const parseProgressPercent = (text: string): number | null => {
  const match = text.match(/(\d{1,3})%/u);
  if (match === null) return null;
  return Math.min(100, Number(match[1]));
};

const sanitizeTarget = (target: Record<string, unknown>): Record<string, unknown> =>
  sanitizeValue(target) as Record<string, unknown>;

const sanitizeValue = (value: unknown): unknown => {
  if (typeof value === 'string') return redactSensitiveText(value);
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [key, sanitizeValue(nestedValue)]),
    );
  }
  return value;
};

const toOperationError = (error: unknown): { code: string; message: string } => {
  if (error instanceof GitWebUiError) return { code: error.code, message: error.message };
  if (error instanceof Error) return { code: 'INTERNAL_ERROR', message: error.message };
  return { code: 'INTERNAL_ERROR', message: '操作失败。' };
};
