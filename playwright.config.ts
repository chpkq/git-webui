import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: 'html',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'corepack pnpm --filter @git-webui/server start',
      url: 'http://127.0.0.1:3000/health',
      reuseExistingServer: true,
    },
    {
      command: 'corepack pnpm --filter @git-webui/web dev',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: true,
    },
  ],
});
