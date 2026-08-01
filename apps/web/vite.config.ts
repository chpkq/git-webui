import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const serverPort = Number(process.env.GIT_WEBUI_SERVER_PORT ?? '3000');
const webPort = Number(process.env.GIT_WEBUI_WEB_PORT ?? '5173');

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: webPort,
    proxy: {
      '/health': `http://127.0.0.1:${serverPort}`,
      '/api': `http://127.0.0.1:${serverPort}`,
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
  },
});
