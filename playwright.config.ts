import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { defineConfig, devices } from '@playwright/test';

const e2eServerPort = 3100;
const e2eWebPort = 5174;
const e2eDataRoot = path.join(os.tmpdir(), `git-webui-playwright-${process.pid}`);
const inheritedEnvironment = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
);
const e2eEnvironment = {
  ...inheritedEnvironment,
  GIT_WEBUI_ALLOWED_ROOTS: [path.resolve(process.cwd()), os.tmpdir()].join(path.delimiter),
  GIT_WEBUI_AUTH_ENABLED: 'false',
  GIT_WEBUI_DATABASE: path.join(e2eDataRoot, 'data.sqlite'),
  GIT_WEBUI_HOST: '127.0.0.1',
  GIT_WEBUI_PORT: String(e2eServerPort),
  GIT_WEBUI_SERVER_PORT: String(e2eServerPort),
  GIT_WEBUI_WEB_PORT: String(e2eWebPort),
};

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'html',
  use: {
    baseURL: `http://127.0.0.1:${e2eWebPort}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'corepack pnpm --filter @git-webui/server start',
      url: `http://127.0.0.1:${e2eServerPort}/health`,
      env: e2eEnvironment,
      reuseExistingServer: false,
    },
    {
      command: 'corepack pnpm --filter @git-webui/web dev',
      url: `http://127.0.0.1:${e2eWebPort}`,
      env: e2eEnvironment,
      reuseExistingServer: false,
    },
  ],
});
