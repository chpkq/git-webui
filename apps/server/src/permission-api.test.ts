import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CommandRunner } from '@git-webui/git-core';
import { describe, expect, it } from 'vitest';
import { AppDatabase } from './database.js';
import { buildServer } from './app.js';
import { RepositoryStore } from './repository-store.js';

const runGit = async (cwd: string, args: string[]): Promise<void> => {
  const result = await new CommandRunner().run({ cwd, args });
  if (result.exitCode !== 0) throw new Error(result.stderr);
};

describe('permission API', () => {
  it('rejects viewer writes at the route boundary while allowing reads', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'git-webui-permission-'));
    const repositoryPath = path.join(root, 'repository');
    const databasePath = path.join(root, 'data.sqlite');
    await mkdir(repositoryPath);
    await runGit(repositoryPath, ['init', '-b', 'main']);
    await runGit(repositoryPath, ['config', 'user.name', '权限测试']);
    await runGit(repositoryPath, ['config', 'user.email', 'permission@example.com']);
    await writeFile(path.join(repositoryPath, 'readme.md'), '# permission\n');
    await runGit(repositoryPath, ['add', '--', 'readme.md']);
    await runGit(repositoryPath, ['commit', '-m', '权限初始提交']);
    const database = new AppDatabase(databasePath);
    const repository = new RepositoryStore(database).create({
      name: '权限测试仓库',
      path: await realpath(repositoryPath),
    });
    database.close();

    const app = await buildServer({
      host: '127.0.0.1',
      port: 3000,
      version: 'test',
      allowedRoots: [root],
      databasePath,
      role: 'viewer',
    });
    try {
      const read = await app.inject({
        method: 'GET',
        url: `/api/repositories/${repository.id}/locations`,
      });
      if (read.statusCode !== 200) throw new Error(JSON.stringify(read.json()));
      expect(read.statusCode).toBe(200);

      const stage = await app.inject({
        method: 'POST',
        url: `/api/repositories/${repository.id}/stage`,
        payload: { paths: ['file.txt'] },
      });
      expect(stage.json()).toMatchObject({ error: { code: 'PERMISSION_DENIED' } });

      const branch = await app.inject({
        method: 'POST',
        url: `/api/repositories/${repository.id}/branches`,
        payload: { name: 'feature/viewer' },
      });
      expect(branch.json()).toMatchObject({ error: { code: 'PERMISSION_DENIED' } });

      const remove = await app.inject({
        method: 'DELETE',
        url: `/api/repositories/${repository.id}`,
      });
      expect(remove.json()).toMatchObject({ error: { code: 'PERMISSION_DENIED' } });
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
