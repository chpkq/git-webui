import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  emptyOperationInputSchema,
  pathsMutationSchema,
  pushOperationInputSchema,
  type UserRole,
} from '@git-webui/shared';
import { GitWebUiError } from '@git-webui/shared';
import type { OperationService } from '../operation-service.js';
import type { OperationUpdatedEvent } from '../operation-service.js';
import type { RepositoryChangedEvent, RepositoryWatcher } from '../repository-watcher.js';

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

const getActor = (request: FastifyRequest): string =>
  request.authUser === null ? 'local-user' : `role:${request.authUser.role}`;

export const registerOperationRoutes = async (
  app: FastifyInstance,
  service: OperationService,
  role: UserRole,
  watcher?: RepositoryWatcher,
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
    return await service.runFileOperation(
      getRepositoryId(request),
      'stage',
      input.paths,
      getActor(request),
    );
  });

  app.post<{ Params: { id: string } }>('/api/repositories/:id/unstage', async (request) => {
    assertCanWrite(role);
    const input = pathsMutationSchema.parse(request.body);
    return await service.runFileOperation(
      getRepositoryId(request),
      'unstage',
      input.paths,
      getActor(request),
    );
  });

  app.post<{ Params: { id: string } }>('/api/repositories/:id/fetch', async (request) => {
    assertCanWrite(role);
    const target = emptyOperationInputSchema.parse(request.body ?? {});
    return await service.runRemoteOperation(
      getRepositoryId(request),
      'fetch',
      target,
      getActor(request),
    );
  });

  app.post<{ Params: { id: string } }>('/api/repositories/:id/pull', async (request) => {
    assertCanWrite(role);
    const target = emptyOperationInputSchema.parse(request.body ?? {});
    return await service.runRemoteOperation(
      getRepositoryId(request),
      'pull',
      target,
      getActor(request),
    );
  });

  app.post<{ Params: { id: string } }>('/api/repositories/:id/push', async (request) => {
    assertCanWrite(role);
    const input = pushOperationInputSchema.parse(request.body);
    return await service.runRemoteOperation(
      getRepositoryId(request),
      'push',
      input,
      getActor(request),
    );
  });

  app.get('/api/operations/events', async (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream',
      'X-Accel-Buffering': 'no',
    });
    const send = (event: OperationUpdatedEvent | RepositoryChangedEvent): void => {
      const data = event.type === 'operation.updated' ? event.operation : event;
      reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const unsubscribe = service.subscribe(send);
    const unsubscribeWatcher = watcher?.subscribe(send);
    const heartbeat = setInterval(() => reply.raw.write(': heartbeat\n\n'), 15_000);
    const cleanup = (): void => {
      clearInterval(heartbeat);
      unsubscribe();
      unsubscribeWatcher?.();
    };
    request.raw.once('close', cleanup);
  });
};
