import { describe, expect, it } from 'vitest';
import { buildServer } from './app.js';

describe('server health route', () => {
  it('returns a structured health response', async () => {
    const app = await buildServer({ host: '127.0.0.1', port: 3000, version: 'test' });
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ok',
      service: 'git-webui-server',
      version: 'test',
      bindAddress: '127.0.0.1:3000',
    });
    await app.close();
  });
});
