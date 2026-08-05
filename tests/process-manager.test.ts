import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  getLaunchEnvironment,
  getServiceConfig,
  getServicePaths,
  main,
  renderLaunchAgentPlist,
} from '../bin/git-webui.mjs';
import {
  assertSecureEnvironmentFile,
  hasRequiredAuthSecrets,
  loadProjectEnvironment,
} from '../scripts/environment.mjs';

describe('git-webui process manager', () => {
  it('uses isolated state and log paths from the environment', () => {
    const config = getServiceConfig({
      env: {
        GIT_WEBUI_STATE_DIR: '/tmp/git-webui-state',
        GIT_WEBUI_LOG_DIR: '/tmp/git-webui-log',
        GIT_WEBUI_WEB_PORT: '19001',
        GIT_WEBUI_SERVER_PORT: '13001',
      },
      homeDirectory: '/Users/example',
      root: '/Users/example/git-webui',
      executable: '/Users/example/git-webui/bin/git-webui.mjs',
    });

    expect(config.webPort).toBe(19001);
    expect(config.serverPort).toBe(13001);
    expect(config.paths.pidFile).toBe('/tmp/git-webui-state/service.pid');
    expect(config.paths.logFile).toBe('/tmp/git-webui-log/service.log');
  });

  it('rejects invalid service ports before spawning a process', () => {
    expect(() =>
      getServiceConfig({
        env: { GIT_WEBUI_WEB_PORT: 'not-a-port' },
      }),
    ).toThrow('GIT_WEBUI_WEB_PORT');
  });

  it('does not copy credentials into a generated LaunchAgent environment', () => {
    const config = getServiceConfig({
      env: {
        GIT_WEBUI_ALLOWED_ROOTS: '/Users/example/workspaces',
        GIT_WEBUI_AUTH_PASSWORD: 'do-not-persist',
        GIT_WEBUI_SESSION_SECRET: 'do-not-persist-either',
      },
    });

    const environment = getLaunchEnvironment(config);
    expect(environment.GIT_WEBUI_ALLOWED_ROOTS).toBe('/Users/example/workspaces');
    expect(environment.GIT_WEBUI_AUTH_PASSWORD).toBeUndefined();
    expect(environment.GIT_WEBUI_SESSION_SECRET).toBeUndefined();
  });

  it('loads allowedRoots for CLI startup without copying secrets to LaunchAgent', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'git-webui-process-env-'));
    try {
      const envFilePath = path.join(projectRoot, '.env');
      await writeFile(
        envFilePath,
        [
          'GIT_WEBUI_ALLOWED_ROOTS=/Users/example/workspaces',
          'GIT_WEBUI_AUTH_ENABLED=true',
          'GIT_WEBUI_AUTH_PASSWORD=correct-horse-battery-staple',
          'GIT_WEBUI_SESSION_SECRET=01234567890123456789012345678901',
          '',
        ].join('\n'),
      );
      if (process.platform !== 'win32') await chmod(envFilePath, 0o600);

      const loaded = loadProjectEnvironment({}, projectRoot);
      expect(loaded.environment.GIT_WEBUI_ALLOWED_ROOTS).toBe('/Users/example/workspaces');
      expect(hasRequiredAuthSecrets(loaded.fileEnvironment)).toBe(true);
      expect(() => assertSecureEnvironmentFile(loaded.envFilePath)).not.toThrow();

      const config = getServiceConfig({
        env: loaded.environment,
        environmentFilePath: loaded.envFilePath,
        environmentFileValues: loaded.fileEnvironment,
        root: projectRoot,
      });
      const launchEnvironment = getLaunchEnvironment(config);
      expect(launchEnvironment).toEqual({
        GIT_WEBUI_ALLOWED_ROOTS: '/Users/example/workspaces',
        GIT_WEBUI_AUTH_ENABLED: 'true',
        GIT_WEBUI_LAUNCH_MODE: 'launchd',
      });
      expect(launchEnvironment).not.toHaveProperty('GIT_WEBUI_AUTH_PASSWORD');
      expect(launchEnvironment).not.toHaveProperty('GIT_WEBUI_SESSION_SECRET');
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('inherits loaded .env into the foreground child environment', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'git-webui-process-inherit-'));
    const keys = [
      'GIT_WEBUI_ALLOWED_ROOTS',
      'GIT_WEBUI_STATE_DIR',
      'GIT_WEBUI_LOG_DIR',
      'GIT_WEBUI_WEB_PORT',
      'GIT_WEBUI_SERVER_PORT',
    ];
    const previousValues = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    try {
      await writeFile(
        path.join(projectRoot, '.env'),
        [
          'GIT_WEBUI_ALLOWED_ROOTS=/Users/example/workspaces',
          `GIT_WEBUI_STATE_DIR=${path.join(projectRoot, 'state')}`,
          `GIT_WEBUI_LOG_DIR=${path.join(projectRoot, 'logs')}`,
          'GIT_WEBUI_WEB_PORT=19001',
          'GIT_WEBUI_SERVER_PORT=13001',
          '',
        ].join('\n'),
      );

      await main(['status'], { root: projectRoot });
      expect(process.env.GIT_WEBUI_ALLOWED_ROOTS).toBe('/Users/example/workspaces');
    } finally {
      for (const key of keys) {
        const previousValue = previousValues[key];
        if (previousValue === undefined) delete process.env[key];
        else process.env[key] = previousValue;
      }
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('rejects a sensitive .env file that is readable by other users', async () => {
    if (process.platform === 'win32') return;

    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'git-webui-process-permission-'));
    try {
      const envFilePath = path.join(projectRoot, '.env');
      await writeFile(envFilePath, 'GIT_WEBUI_AUTH_PASSWORD=secret\n');
      await chmod(envFilePath, 0o644);

      expect(() => loadProjectEnvironment({}, projectRoot)).toThrow('chmod 600');
      expect(() => assertSecureEnvironmentFile(envFilePath)).toThrow('chmod 600');
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('renders safe XML and foreground arguments for launchd', () => {
    const plist = renderLaunchAgentPlist({
      label: 'dev.git-webui.service',
      nodePath: '/opt/node & current/node',
      executable: '/Users/example/git webui/bin/git-webui.mjs',
      workingDirectory: '/Users/example/git <webui>',
      environment: { GIT_WEBUI_ALLOWED_ROOTS: '/Users/example/workspaces' },
      standardOutPath: '/Users/example/Library/Logs/git-webui/service.log',
      standardErrorPath: '/Users/example/Library/Logs/git-webui/service.log',
    });

    expect(plist).toContain('<true/>');
    expect(plist).toContain('<key>KeepAlive</key>');
    expect(plist).toContain('&amp;');
    expect(plist).toContain('&lt;webui&gt;');
    expect(plist).toContain('<string>serve</string>');
    expect(plist).toContain('<string>--foreground</string>');
    expect(plist).toContain('<key>StandardOutPath</key>');
    expect(plist).toContain('<key>StandardErrorPath</key>');
  });

  it('keeps the LaunchAgent default path under the user home', () => {
    const paths = getServicePaths({
      env: {},
      homeDirectory: '/Users/example',
      root: '/Users/example/git-webui',
      executable: '/Users/example/git-webui/bin/git-webui.mjs',
    });

    expect(paths.launchAgentPath).toBe(
      '/Users/example/Library/LaunchAgents/dev.git-webui.service.plist',
    );
  });
});
