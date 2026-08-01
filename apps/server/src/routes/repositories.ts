import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  commitsQuerySchema,
  diffQuerySchema,
  registerRepositoryInputSchema,
} from '@git-webui/shared';
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

  app.get<{
    Params: { id: string };
    Querystring: { ref?: string; cursor?: string; limit?: string };
  }>('/api/repositories/:id/commits', async (request) => {
    const query = commitsQuerySchema.parse(request.query);
    const offset = query.cursor === undefined ? 0 : Number(query.cursor);
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new GitWebUiError('INVALID_REQUEST', 'Commit 分页 cursor 格式不正确。');
    }
    return await service.getCommits(getRepositoryId(request), query.ref, offset, query.limit);
  });

  app.get<{ Params: { id: string; commitish: string } }>(
    '/api/repositories/:id/commits/:commitish',
    async (request) =>
      await service.getCommitDetail(getRepositoryId(request), request.params.commitish),
  );

  app.get<{
    Params: { id: string };
    Querystring: {
      kind?: string;
      path?: string;
      ref?: string;
      baseRef?: string;
      maxBytes?: string;
    };
  }>('/api/repositories/:id/diff', async (request) => {
    const query = diffQuerySchema.parse(request.query);
    return await service.getDiff(getRepositoryId(request), query);
  });
};
