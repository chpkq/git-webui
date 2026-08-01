import Fastify from 'fastify';
import { registerHealthRoutes } from './routes/health.js';
import type { ServerConfig } from './config.js';
import { AppDatabase } from './database.js';
import { RepositoryStore } from './repository-store.js';
import { RepositoryService } from './repository-service.js';
import { registerRepositoryRoutes } from './routes/repositories.js';
import { registerOperationRoutes } from './routes/operations.js';
import { OperationStore } from './operation-store.js';
import { OperationService } from './operation-service.js';
import { GitProvider } from '@git-webui/git-core';
import { GitWebUiError } from '@git-webui/shared';
import { ZodError } from 'zod';

export const buildServer = async (config: ServerConfig) => {
  const app = Fastify({ logger: false });
  const database = new AppDatabase(config.databasePath);
  const repositoryService = new RepositoryService(
    new RepositoryStore(database),
    new GitProvider({ allowedRoots: config.allowedRoots }),
  );
  const operationService = new OperationService(
    repositoryService,
    new GitProvider({ allowedRoots: config.allowedRoots }),
    new OperationStore(database),
  );
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof GitWebUiError) {
      return reply.code(error.code === 'NOT_FOUND' ? 404 : 400).send({
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
          requestId: request.id,
        },
      });
    }
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: 'INVALID_REQUEST',
          message: '请求参数不符合 API 契约。',
          details: {
            issues: error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
          },
          requestId: request.id,
        },
      });
    }
    return reply.code(500).send({
      error: { code: 'INTERNAL_ERROR', message: '服务器内部错误。', requestId: request.id },
    });
  });
  app.addHook('onClose', async () => database.close());
  await registerHealthRoutes(app, config);
  await registerRepositoryRoutes(app, repositoryService);
  await registerOperationRoutes(app, operationService, config.role);
  return app;
};
