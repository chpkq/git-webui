import { describe, expect, it } from 'vitest';

import {
  getLaunchEnvironment,
  getServiceConfig,
  getServicePaths,
  renderLaunchAgentPlist,
} from '../bin/git-webui.mjs';

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
