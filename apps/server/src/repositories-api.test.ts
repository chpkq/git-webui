import { access, mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CommandRunner } from '@git-webui/git-core';
import { buildServer } from './app.js';

const runGit = async (cwd: string, args: string[]): Promise<void> => {
  const result = await new CommandRunner().run({ cwd, args });
  if (result.exitCode !== 0) throw new Error(result.stderr);
};

describe('repository REST API', () => {
  it('registers, queries, and removes a real repository without deleting it', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'git-webui-api-'));
    const repositoryPath = path.join(root, 'repository');
    await mkdir(repositoryPath);
    await runGit(repositoryPath, ['init', '-b', 'main']);
    await runGit(repositoryPath, ['config', 'user.name', 'API 测试']);
    await runGit(repositoryPath, ['config', 'user.email', 'api@example.com']);
    await writeFile(path.join(repositoryPath, 'readme.md'), '# test\n');
    await runGit(repositoryPath, ['add', '--', 'readme.md']);
    await runGit(repositoryPath, ['commit', '-m', '初始化测试仓库']);

    const app = await buildServer({
      host: '127.0.0.1',
      port: 3000,
      version: 'test',
      allowedRoots: [root],
      databasePath: path.join(root, 'data.sqlite'),
      role: 'admin',
    });
    try {
      expect((await app.inject({ method: 'GET', url: '/api/repositories' })).json()).toEqual({
        items: [],
      });

      const created = await app.inject({
        method: 'POST',
        url: '/api/repositories',
        payload: { path: repositoryPath, name: '测试仓库' },
      });
      expect(created.statusCode).toBe(201);
      const repository = created.json() as { id: string; path: string; name: string };
      expect(repository).toMatchObject({ path: await realpath(repositoryPath), name: '测试仓库' });

      const status = await app.inject({
        method: 'GET',
        url: `/api/repositories/${repository.id}/status`,
      });
      expect(status.statusCode).toBe(200);
      expect(status.json().status).toMatchObject({ branch: 'main', dirty: false, entries: [] });

      const locations = await app.inject({
        method: 'GET',
        url: `/api/repositories/${repository.id}/locations`,
      });
      expect(locations.statusCode).toBe(200);
      expect(locations.json().locations.branches).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'main', current: true })]),
      );

      const commits = await app.inject({
        method: 'GET',
        url: `/api/repositories/${repository.id}/commits?ref=HEAD&limit=10`,
      });
      expect(commits.statusCode).toBe(200);
      expect(commits.json().page.items).toEqual(
        expect.arrayContaining([expect.objectContaining({ subject: '初始化测试仓库' })]),
      );
      const commitHash = commits.json().page.items[0].hash as string;
      const detail = await app.inject({
        method: 'GET',
        url: `/api/repositories/${repository.id}/commits/${commitHash}`,
      });
      expect(detail.statusCode).toBe(200);
      expect(detail.json().detail.changedFiles).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: 'readme.md', additions: 1 })]),
      );

      await writeFile(path.join(repositoryPath, 'readme.md'), '# changed\n');
      const diff = await app.inject({
        method: 'GET',
        url: `/api/repositories/${repository.id}/diff?kind=working&path=readme.md`,
      });
      expect(diff.statusCode).toBe(200);
      expect(diff.json().diff.content).toContain('+# changed');

      const stage = await app.inject({
        method: 'POST',
        url: `/api/repositories/${repository.id}/stage`,
        payload: { paths: ['readme.md'] },
      });
      expect(stage.statusCode).toBe(200);
      expect(stage.json()).toMatchObject({ type: 'stage', status: 'success' });
      const stagedStatus = await app.inject({
        method: 'GET',
        url: `/api/repositories/${repository.id}/status`,
      });
      expect(stagedStatus.json().status.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: 'readme.md', staged: true, unstaged: false }),
        ]),
      );

      const unstage = await app.inject({
        method: 'POST',
        url: `/api/repositories/${repository.id}/unstage`,
        payload: { paths: ['readme.md'] },
      });
      expect(unstage.statusCode).toBe(200);
      expect(unstage.json()).toMatchObject({ type: 'unstage', status: 'success' });

      await writeFile(path.join(repositoryPath, 'one.txt'), 'one\n');
      await writeFile(path.join(repositoryPath, 'two.txt'), 'two\n');
      const concurrentResults = await Promise.all([
        app.inject({
          method: 'POST',
          url: `/api/repositories/${repository.id}/stage`,
          payload: { paths: ['readme.md', 'one.txt'] },
        }),
        app.inject({
          method: 'POST',
          url: `/api/repositories/${repository.id}/stage`,
          payload: { paths: ['two.txt'] },
        }),
      ]);
      expect(concurrentResults.map((response) => response.json().status)).toEqual([
        'success',
        'success',
      ]);
      expect(
        (
          await app.inject({ method: 'GET', url: `/api/operations?repositoryId=${repository.id}` })
        ).json(),
      ).toEqual(
        expect.arrayContaining([expect.objectContaining({ status: 'success', type: 'stage' })]),
      );

      const removed = await app.inject({
        method: 'DELETE',
        url: `/api/repositories/${repository.id}`,
      });
      expect(removed.statusCode).toBe(204);
      await expect(access(repositoryPath)).resolves.toBeUndefined();
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  }, 20_000);

  it('returns a stable error for a repository outside allowedRoots', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'git-webui-api-root-'));
    const outside = await mkdtemp(path.join(os.tmpdir(), 'git-webui-api-outside-'));
    const app = await buildServer({
      host: '127.0.0.1',
      port: 3000,
      version: 'test',
      allowedRoots: [root],
      databasePath: path.join(root, 'data.sqlite'),
      role: 'admin',
    });
    try {
      await runGit(outside, ['init', '-b', 'main']);
      const response = await app.inject({
        method: 'POST',
        url: '/api/repositories',
        payload: { path: outside },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: { code: 'REPOSITORY_NOT_ALLOWED' } });
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});
