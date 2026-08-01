import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildServer } from './app.js';

describe('server health route', () => {
  it('returns a structured health response', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'git-webui-server-'));
    const app = await buildServer({
      host: '127.0.0.1',
      port: 3000,
      version: 'test',
      allowedRoots: [root],
      databasePath: path.join(root, 'data.sqlite'),
      role: 'admin',
    });
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ok',
      service: 'git-webui-server',
      version: 'test',
      bindAddress: '127.0.0.1:3000',
    });
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
});
