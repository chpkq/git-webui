import type { FastifyInstance, FastifyRequest } from 'fastify';
import { registerRepositoryInputSchema } from '@git-webui/shared';
import { GitWebUiError } from '@git-webui/shared';
import type { RepositoryService } from '../repository-service.js';

const getRepositoryId = (request: FastifyRequest<{ Params: { id: string } }>): string => {
  const id = request.params.id;
  if (!/^[0-9a-f-]{36}$/iu.test(id))
    throw new GitWebUiError('INVALID_REQUEST', '仓库 ID 格式不正确。');
  return id;
};

const parseBody = <T>(schema: { parse: (value: unknown) => T }, body: unknown): T =>
  schema.parse(body);

export const registerRepositoryRoutes = async (
  app: FastifyInstance,
  service: RepositoryService,
): Promise<void> => {
  app.get('/api/repositories', async () => ({ items: service.list() }));

  app.post('/api/repositories', async (request, reply) => {
    const input = parseBody(registerRepositoryInputSchema, request.body);
    const repository = await service.register(input);
    return await reply.code(201).send(repository);
  });

  app.delete<{ Params: { id: string } }>('/api/repositories/:id', async (request, reply) => {
    service.remove(getRepositoryId(request));
    return await reply.code(204).send();
  });

  app.get<{ Params: { id: string } }>('/api/repositories/:id/status', async (request) => {
    return await service.getStatus(getRepositoryId(request));
  });

  app.get<{ Params: { id: string } }>('/api/repositories/:id/locations', async (request) => {
    return await service.getLocations(getRepositoryId(request));
  });
};
