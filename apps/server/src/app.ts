import Fastify from 'fastify';
import { registerHealthRoutes } from './routes/health.js';
import type { ServerConfig } from './config.js';
import { AppDatabase } from './database.js';
import { RepositoryStore } from './repository-store.js';
import { RepositoryService } from './repository-service.js';
import { registerRepositoryRoutes } from './routes/repositories.js';
import { registerOperationRoutes } from './routes/operations.js';
import { registerManagementRoutes } from './routes/management.js';
import { OperationStore } from './operation-store.js';
import { OperationService } from './operation-service.js';
import { GitProvider } from '@git-webui/git-core';
import { GitWebUiError } from '@git-webui/shared';
import { ZodError } from 'zod';
import { AuthService } from './auth.js';
import { registerAuthRoutes } from './routes/auth.js';
import { RepositoryWatcher } from './repository-watcher.js';

export const buildServer = async (config: ServerConfig) => {
  const app = Fastify({ logger: false });
  const database = new AppDatabase(config.databasePath);
  const auth = new AuthService({
    enabled: config.authEnabled ?? false,
    password: config.authPassword ?? null,
    sessionSecret: config.sessionSecret ?? null,
    role: config.role,
    sessionTtlMs: config.sessionTtlMs ?? 8 * 60 * 60 * 1000,
    cookieSecure: config.cookieSecure ?? false,
  });
  app.decorateRequest('authUser', null);
  app.addHook('onRequest', async (request) => {
    const isPublic = request.url === '/health' || request.url.startsWith('/api/auth/');
    const user = auth.getSession(request.headers.cookie);
    request.authUser = user;
    if (!auth.enabled || isPublic) return;
    if (user === null) {
      throw new GitWebUiError('AUTH_REQUIRED', '请先登录后再访问 Git WebUI。');
    }
    if (
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method) &&
      !auth.hasValidCsrf(user, request)
    ) {
      throw new GitWebUiError('CSRF_REQUIRED', '请求缺少有效的 CSRF 校验。');
    }
  });
  const gitProvider = new GitProvider({ allowedRoots: config.allowedRoots });
  const repositoryService = new RepositoryService(
    new RepositoryStore(database),
    gitProvider,
    config.role,
  );
  const operationService = new OperationService(
    repositoryService,
    gitProvider,
    new OperationStore(database),
    config.role,
  );
  const repositoryWatcher = new RepositoryWatcher(repositoryService);
  repositoryWatcher.start();
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof GitWebUiError) {
      const statusCode =
        error.code === 'NOT_FOUND'
          ? 404
          : error.code === 'AUTH_REQUIRED'
            ? 401
            : error.code === 'CSRF_REQUIRED' || error.code === 'PERMISSION_DENIED'
              ? 403
              : error.code === 'RATE_LIMITED'
                ? 429
                : 400;
      return reply.code(statusCode).send({
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
  app.addHook('onClose', async () => {
    repositoryWatcher.stop();
    database.close();
  });
  await registerHealthRoutes(app, config);
  await registerAuthRoutes(app, auth);
  await registerRepositoryRoutes(app, repositoryService, config.role);
  await registerOperationRoutes(app, operationService, config.role, repositoryWatcher);
  await registerManagementRoutes(app, operationService, gitProvider, config.role);
  return app;
};
