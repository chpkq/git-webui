import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@git-webui/shared': fileURLToPath(
        new URL('./packages/shared/src/index.ts', import.meta.url),
      ),
      '@git-webui/git-core': fileURLToPath(
        new URL('./packages/git-core/src/index.ts', import.meta.url),
      ),
      '@git-webui/ui-components': fileURLToPath(
        new URL('./packages/ui-components/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 120_000,
    coverage: {
      reporter: ['text', 'html'],
      exclude: ['**/dist/**'],
    },
  },
});
