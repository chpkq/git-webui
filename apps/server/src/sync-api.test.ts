import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CommandRunner } from '@git-webui/git-core';
import { buildServer } from './app.js';

const runGit = async (cwd: string, args: string[]): Promise<string> => {
  const result = await new CommandRunner().run({ cwd, args });
  if (result.exitCode !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
};

const setupRepository = async (
  root: string,
): Promise<{ repositoryPath: string; remotePath: string }> => {
  const repositoryPath = path.join(root, 'repository');
  const remotePath = path.join(root, 'remote.git');
  await mkdir(repositoryPath);
  await runGit(root, ['init', '--bare', remotePath]);
  await runGit(repositoryPath, ['init', '-b', 'main']);
  await runGit(repositoryPath, ['config', 'user.name', '同步测试']);
  await runGit(repositoryPath, ['config', 'user.email', 'sync@example.com']);
  await runGit(repositoryPath, ['remote', 'add', 'origin', remotePath]);
  await writeFile(path.join(repositoryPath, 'readme.md'), '# sync\n');
  await runGit(repositoryPath, ['add', '--', 'readme.md']);
  await runGit(repositoryPath, ['commit', '-m', '同步初始提交']);
  await runGit(repositoryPath, ['push', '--set-upstream', 'origin', 'main']);
  return { repositoryPath, remotePath };
};

describe('sync operation API', () => {
  it('runs fetch, refuses dirty pull, then performs ff-only pull and explicit push', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'git-webui-sync-'));
    const { repositoryPath, remotePath } = await setupRepository(root);
    const otherPath = path.join(root, 'other');
    const app = await buildServer({
      host: '127.0.0.1',
      port: 3000,
      version: 'test',
      allowedRoots: [root],
      databasePath: path.join(root, 'data.sqlite'),
      role: 'admin',
    });
    try {
      await runGit(root, ['clone', remotePath, otherPath]);
      await runGit(otherPath, ['config', 'user.name', '远端测试']);
      await runGit(otherPath, ['config', 'user.email', 'remote@example.com']);

      const created = await app.inject({
        method: 'POST',
        url: '/api/repositories',
        payload: { path: repositoryPath },
      });
      const repositoryId = created.json().id as string;

      const fetch = await app.inject({
        method: 'POST',
        url: `/api/repositories/${repositoryId}/fetch`,
        payload: {},
      });
      expect(fetch.json()).toMatchObject({ type: 'fetch', status: 'success' });

      await writeFile(path.join(repositoryPath, 'dirty.txt'), 'dirty\n');
      const dirtyPull = await app.inject({
        method: 'POST',
        url: `/api/repositories/${repositoryId}/pull`,
        payload: {},
      });
      expect(dirtyPull.json()).toMatchObject({
        type: 'pull',
        status: 'failed',
        preflight: { dirty: true },
        error: { code: 'DIRTY_WORKTREE' },
      });
      await rm(path.join(repositoryPath, 'dirty.txt'), { force: true });

      await writeFile(path.join(otherPath, 'remote.txt'), 'remote\n');
      await runGit(otherPath, ['add', '--', 'remote.txt']);
      await runGit(otherPath, ['commit', '-m', '远端新提交']);
      await runGit(otherPath, ['push', 'origin', 'main']);

      const pull = await app.inject({
        method: 'POST',
        url: `/api/repositories/${repositoryId}/pull`,
        payload: {},
      });
      expect(pull.json()).toMatchObject({ type: 'pull', status: 'success' });
      await expect(access(path.join(repositoryPath, 'remote.txt'))).resolves.toBeUndefined();

      await writeFile(path.join(repositoryPath, 'local.txt'), 'local\n');
      await runGit(repositoryPath, ['add', '--', 'local.txt']);
      await runGit(repositoryPath, ['commit', '-m', '本地新提交']);
      const push = await app.inject({
        method: 'POST',
        url: `/api/repositories/${repositoryId}/push`,
        payload: { remote: 'origin', branch: 'main', setUpstream: false },
      });
      expect(push.json()).toMatchObject({ type: 'push', status: 'success' });
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});
