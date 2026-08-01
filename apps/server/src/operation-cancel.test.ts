import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CommandRunner,
  GitProvider,
  type CommandResult,
  type CommandRunnerOptions,
} from '@git-webui/git-core';
import { GitWebUiError } from '@git-webui/shared';
import { AppDatabase } from './database.js';
import { OperationService } from './operation-service.js';
import { OperationStore } from './operation-store.js';
import { RepositoryService } from './repository-service.js';
import { RepositoryStore } from './repository-store.js';

class SlowFetchRunner extends CommandRunner {
  public override async run(options: CommandRunnerOptions): Promise<CommandResult> {
    const firstArgument = options.args[0];
    if (firstArgument === 'fetch') {
      return await new Promise<CommandResult>((_resolve, reject) => {
        const cancel = (): void => reject(new GitWebUiError('COMMAND_TIMEOUT', '已取消。'));
        if (options.signal?.aborted) {
          cancel();
          return;
        }
        options.signal?.addEventListener('abort', cancel, { once: true });
      });
    }
    if (firstArgument === 'rev-parse' && options.args[1] === '--show-toplevel') {
      return result(options, `${options.cwd}\n`);
    }
    if (firstArgument === 'rev-parse' && options.args[1] === '--git-dir') {
      return result(options, '.git\n');
    }
    if (firstArgument === 'status') {
      return result(options, `# branch.oid ${'a'.repeat(40)}\0# branch.head main\0`);
    }
    return result(options, '');
  }
}

describe('operation cancellation', () => {
  it('aborts an in-flight fetch and records cancelled status', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'git-webui-cancel-'));
    const repositoryPath = path.join(root, 'repository');
    await mkdir(repositoryPath);
    const database = new AppDatabase(path.join(root, 'data.sqlite'));
    const provider = new GitProvider({ allowedRoots: [root], runner: new SlowFetchRunner() });
    const repositoryService = new RepositoryService(new RepositoryStore(database), provider);
    const operationService = new OperationService(
      repositoryService,
      provider,
      new OperationStore(database),
    );
    try {
      const repository = await repositoryService.register({ path: repositoryPath });
      let operationId: string | undefined;
      let runningResolve: (() => void) | undefined;
      const running = new Promise<void>((resolve) => {
        runningResolve = resolve;
      });
      const unsubscribe = operationService.subscribe((event) => {
        operationId = event.operation.id;
        if (event.operation.status === 'running') runningResolve?.();
      });
      const operationPromise = operationService.runRemoteOperation(repository.id, 'fetch', {});
      await running;
      expect(operationId).toBeDefined();
      expect(operationService.cancel(operationId!)).toMatchObject({ status: 'running' });
      await expect(operationPromise).resolves.toMatchObject({
        status: 'cancelled',
        error: { code: 'CANCELLED' },
      });
      unsubscribe();
    } finally {
      database.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});

const result = (options: CommandRunnerOptions, stdout: string): CommandResult => ({
  command: 'git',
  args: options.args,
  exitCode: 0,
  stdout,
  stderr: '',
  stdoutBytes: Buffer.byteLength(stdout),
  stderrBytes: 0,
  truncated: false,
});
