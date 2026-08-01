import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  GitWebUiError,
  type Operation,
  type OperationType,
  type PreflightSnapshot,
} from '@git-webui/shared';
import type { GitProvider } from '@git-webui/git-core';
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

  public constructor(
    private readonly repositoryService: RepositoryService,
    private readonly gitProvider: GitProvider,
    private readonly store: OperationStore,
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

  public async runFileOperation(
    repositoryId: string,
    type: Extract<OperationType, 'stage' | 'unstage'>,
    paths: readonly string[],
    actor = 'local-user',
  ): Promise<Operation> {
    const repository = await this.repositoryService.getValidated(repositoryId);
    const operation = this.store.create({
      id: randomUUID(),
      repositoryId,
      type,
      target: { paths: [...paths] },
    });
    this.publish(operation);
    try {
      const preflight = await this.createPreflight(repository.path);
      this.publish(this.store.setPreflight(operation.id, preflight));
      const completed = await this.queue.run(repositoryId, async () => {
        const running = this.store.setRunning(operation.id);
        this.publish(running);
        try {
          const currentPreflight = await this.createPreflight(repository.path);
          this.assertPreflightStable(preflight, currentPreflight);
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
    }
  }

  private async createPreflight(repositoryPath: string): Promise<PreflightSnapshot> {
    const status = await this.gitProvider.getStatus(repositoryPath);
    if (status.inProgress.length > 0) {
      throw new GitWebUiError('GIT_IN_PROGRESS', '仓库存在进行中的 Git 状态，不能执行当前操作。', {
        inProgress: status.inProgress,
      });
    }
    return {
      head: status.head,
      branch: status.branch,
      upstream: status.upstream,
      dirty: status.dirty,
      inProgress: status.inProgress,
    };
  }

  private assertPreflightStable(before: PreflightSnapshot, current: PreflightSnapshot): void {
    if (
      before.head !== current.head ||
      before.branch !== current.branch ||
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
}

const toOperationError = (error: unknown): { code: string; message: string } => {
  if (error instanceof GitWebUiError) return { code: error.code, message: error.message };
  if (error instanceof Error) return { code: 'INTERNAL_ERROR', message: error.message };
  return { code: 'INTERNAL_ERROR', message: '操作失败。' };
};
