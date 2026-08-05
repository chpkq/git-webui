import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadProjectEnvironment } from './environment.js';

describe('loadProjectEnvironment', () => {
  it('loads project .env while preserving explicit environment values', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'git-webui-env-'));
    try {
      await writeFile(
        path.join(projectRoot, '.env'),
        [
          'GIT_WEBUI_ALLOWED_ROOTS=/from-file',
          'GIT_WEBUI_SERVER_PORT=3010',
          'GIT_WEBUI_SESSION_SECRET=from-file-session-secret',
          '',
        ].join('\n'),
      );
      if (process.platform !== 'win32') await chmod(path.join(projectRoot, '.env'), 0o600);

      const loaded = loadProjectEnvironment(
        { GIT_WEBUI_ALLOWED_ROOTS: '/explicit-root' },
        projectRoot,
      );

      expect(loaded.environment).toMatchObject({
        GIT_WEBUI_ALLOWED_ROOTS: '/explicit-root',
        GIT_WEBUI_SERVER_PORT: '3010',
        GIT_WEBUI_SESSION_SECRET: 'from-file-session-secret',
      });
      expect(loaded.envFilePath).toBe(path.join(projectRoot, '.env'));
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('keeps the current environment when .env is absent', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'git-webui-env-empty-'));
    try {
      const environment = { GIT_WEBUI_ALLOWED_ROOTS: '/explicit-root' };
      const loaded = loadProjectEnvironment(environment, projectRoot);

      expect(loaded.environment).toEqual(environment);
      expect(loaded.envFilePath).toBeNull();
      await expect(readFile(path.join(projectRoot, '.env'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
