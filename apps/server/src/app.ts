import Fastify from 'fastify';
import { registerHealthRoutes } from './routes/health.js';
import type { ServerConfig } from './config.js';

export const buildServer = async (config: ServerConfig) => {
  const app = Fastify({ logger: false });
  await registerHealthRoutes(app, config);
  return app;
};
