import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CommandRunner } from '@git-webui/git-core';
import { buildServer } from './app.js';

const runGit = async (cwd: string, args: string[]): Promise<void> => {
  const result = await new CommandRunner().run({ cwd, args });
  if (result.exitCode !== 0) throw new Error(result.stderr);
};

describe('remote authentication and CSRF', () => {
  it('requires login and a session CSRF token for write requests', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'git-webui-auth-'));
    const repositoryPath = path.join(root, 'repository');
    await mkdir(repositoryPath);
    await runGit(repositoryPath, ['init', '-b', 'main']);
    const app = await buildServer({
      host: '127.0.0.1',
      port: 3000,
      version: 'test',
      allowedRoots: [root],
      databasePath: path.join(root, 'data.sqlite'),
      role: 'admin',
      authEnabled: true,
      authPassword: 'correct horse battery staple',
      sessionSecret: '01234567890123456789012345678901',
      sessionTtlMs: 60 * 60 * 1000,
    });
    try {
      const anonymous = await app.inject({ method: 'GET', url: '/api/repositories' });
      expect(anonymous.statusCode).toBe(401);

      const me = await app.inject({ method: 'GET', url: '/api/auth/me' });
      expect(me.statusCode).toBe(200);
      expect(me.json()).toMatchObject({ enabled: true, authenticated: false });

      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { password: 'correct horse battery staple' },
      });
      expect(login.statusCode).toBe(200);
      const cookies = login.headers['set-cookie'];
      expect(cookies).toEqual(
        expect.arrayContaining([expect.stringContaining('git_webui_session=')]),
      );
      const cookieHeader = (Array.isArray(cookies) ? cookies : [cookies])
        .map((cookie) => cookie?.split(';')[0])
        .filter((cookie): cookie is string => cookie !== undefined)
        .join('; ');
      const noCsrf = await app.inject({
        method: 'POST',
        url: '/api/repositories',
        headers: { cookie: cookieHeader },
        payload: { path: repositoryPath },
      });
      expect(noCsrf.statusCode).toBe(403);

      const csrfCookie = (Array.isArray(cookies) ? cookies : [cookies]).find((cookie) =>
        cookie?.startsWith('git_webui_csrf='),
      );
      const csrfToken = csrfCookie?.split(';')[0]?.slice('git_webui_csrf='.length);
      expect(csrfToken).toBeTruthy();
      const registered = await app.inject({
        method: 'POST',
        url: '/api/repositories',
        headers: { cookie: cookieHeader, 'x-csrf-token': csrfToken },
        payload: { path: repositoryPath },
      });
      expect(registered.statusCode).toBe(201);
    } finally {
      await app.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
