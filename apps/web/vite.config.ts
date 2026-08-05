import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export default defineConfig(({ mode }) => {
  const fileEnvironment = loadEnv(mode, projectRoot, '');
  const environment = { ...fileEnvironment, ...process.env };
  const serverPort = Number(environment.GIT_WEBUI_SERVER_PORT ?? '3001');
  const webPort = Number(environment.GIT_WEBUI_WEB_PORT ?? '9001');
  const webHost = environment.GIT_WEBUI_WEB_HOST ?? '0.0.0.0';

  return {
    plugins: [react()],
    server: {
      host: webHost,
      port: webPort,
      proxy: {
        '/health': `http://127.0.0.1:${serverPort}`,
        '/api': `http://127.0.0.1:${serverPort}`,
      },
    },
    preview: {
      host: webHost,
      port: webPort,
    },
  };
});
