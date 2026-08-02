import type { FastifyInstance } from 'fastify';
import { healthResponseSchema } from '@git-webui/shared';
import type { ServerConfig } from '../config.js';

export const registerHealthRoutes = async (
  app: FastifyInstance,
  config: ServerConfig,
): Promise<void> => {
  app.get('/health', async () => {
    const response = healthResponseSchema.parse({
      status: 'ok',
      service: 'git-webui-server',
      version: config.version,
      bindAddress: `${config.host}:${config.port}`,
      timestamp: new Date().toISOString(),
    });
    return response;
  });
};
