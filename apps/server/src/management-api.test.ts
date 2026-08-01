import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CommandRunner } from '@git-webui/git-core';
import { buildServer } from './app.js';

const runGit = async (cwd: string, args: string[]): Promise<void> => {
  const result = await new CommandRunner().run({ cwd, args });
  if (result.exitCode !== 0) throw new Error(result.stderr);
};

describe('remote and branch management API', () => {
  it('manages branches and redacts credentials in remote URLs and operation records', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'git-webui-management-'));
    const repositoryPath = path.join(root, 'repository');
    await mkdir(repositoryPath);
    await runGit(repositoryPath, ['init', '-b', 'main']);
    await runGit(repositoryPath, ['config', 'user.name', '管理测试']);
    await runGit(repositoryPath, ['config', 'user.email', 'management@example.com']);
    await writeFile(path.join(repositoryPath, 'readme.md'), '# management\n');
    await runGit(repositoryPath, ['add', '--', 'readme.md']);
    await runGit(repositoryPath, ['commit', '-m', '管理初始提交']);

    const app = await buildServer({
      host: '127.0.0.1',
      port: 3000,
      version: 'test',
      allowedRoots: [root],
      databasePath: path.join(root, 'data.sqlite'),
      role: 'admin',
    });
    try {
      const created = await app.inject({
        method: 'POST',
        url: '/api/repositories',
        payload: { path: repositoryPath },
      });
      const id = created.json().id as string;

      const branch = await app.inject({
        method: 'POST',
        url: `/api/repositories/${id}/branches`,
        payload: { name: 'feature/test' },
      });
      expect(branch.json()).toMatchObject({ type: 'branch-create', status: 'success' });
      const switched = await app.inject({
        method: 'POST',
        url: `/api/repositories/${id}/branches/switch`,
        payload: { name: 'feature/test' },
      });
      expect(switched.json()).toMatchObject({ type: 'branch-switch', status: 'success' });
      const renamed = await app.inject({
        method: 'PATCH',
        url: `/api/repositories/${id}/branches`,
        payload: { oldName: 'feature/test', newName: 'feature/renamed' },
      });
      expect(renamed.json()).toMatchObject({ type: 'branch-rename', status: 'success' });
      const backToMain = await app.inject({
        method: 'POST',
        url: `/api/repositories/${id}/branches/switch`,
        payload: { name: 'main' },
      });
      expect(backToMain.json()).toMatchObject({ type: 'branch-switch', status: 'success' });

      const remote = await app.inject({
        method: 'POST',
        url: `/api/repositories/${id}/remotes`,
        payload: { name: 'origin', fetchUrl: 'https://user:secret@example.com/repo.git' },
      });
      expect(remote.json()).toMatchObject({ type: 'remote-add', status: 'success' });
      const locations = await app.inject({
        method: 'GET',
        url: `/api/repositories/${id}/locations`,
      });
      expect(locations.json().locations.remotes).toEqual([
        expect.objectContaining({ fetchUrl: 'https://user:[REDACTED]@example.com/repo.git' }),
      ]);
      const operations = await app.inject({
        method: 'GET',
        url: `/api/operations?repositoryId=${id}`,
      });
      expect(JSON.stringify(operations.json())).not.toContain('secret');

      const deleted = await app.inject({
        method: 'DELETE',
        url: `/api/repositories/${id}/branches`,
        payload: { name: 'feature/renamed' },
      });
      expect(deleted.json()).toMatchObject({ type: 'branch-delete', status: 'success' });
      const removedRemote = await app.inject({
        method: 'DELETE',
        url: `/api/repositories/${id}/remotes`,
        payload: { name: 'origin' },
      });
      expect(removedRemote.json()).toMatchObject({ type: 'remote-remove', status: 'success' });
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});
