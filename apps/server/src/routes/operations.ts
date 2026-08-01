import type { FastifyInstance, FastifyRequest } from 'fastify';
import { pathsMutationSchema, type UserRole } from '@git-webui/shared';
import { GitWebUiError } from '@git-webui/shared';
import type { OperationService } from '../operation-service.js';

const getRepositoryId = (request: FastifyRequest<{ Params: { id: string } }>): string => {
  const id = request.params.id;
  if (!/^[0-9a-f-]{36}$/iu.test(id)) {
    throw new GitWebUiError('INVALID_REQUEST', '仓库 ID 格式不正确。');
  }
  return id;
};

const assertCanWrite = (role: UserRole): void => {
  if (role === 'viewer')
    throw new GitWebUiError('PERMISSION_DENIED', 'Viewer 角色不能执行写操作。');
};

export const registerOperationRoutes = async (
  app: FastifyInstance,
  service: OperationService,
  role: UserRole,
): Promise<void> => {
  app.get<{ Params: { id: string } }>('/api/operations/:id', async (request) =>
    service.get(request.params.id),
  );

  app.get<{ Querystring: { repositoryId?: string } }>('/api/operations', async (request) =>
    service.list(request.query.repositoryId),
  );

  app.post<{ Params: { id: string } }>('/api/repositories/:id/stage', async (request) => {
    assertCanWrite(role);
    const input = pathsMutationSchema.parse(request.body);
    return await service.runFileOperation(getRepositoryId(request), 'stage', input.paths);
  });

  app.post<{ Params: { id: string } }>('/api/repositories/:id/unstage', async (request) => {
    assertCanWrite(role);
    const input = pathsMutationSchema.parse(request.body);
    return await service.runFileOperation(getRepositoryId(request), 'unstage', input.paths);
  });
};
