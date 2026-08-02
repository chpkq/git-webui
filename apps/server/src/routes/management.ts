import type { FastifyInstance } from 'fastify';
import {
  branchCreateInputSchema,
  branchDeleteInputSchema,
  branchRenameInputSchema,
  branchSwitchInputSchema,
  branchUpstreamInputSchema,
  remoteAddInputSchema,
  remoteRemoveInputSchema,
  remoteSetUrlInputSchema,
  type UserRole,
} from '@git-webui/shared';
import { GitWebUiError } from '@git-webui/shared';
import type { GitProvider } from '@git-webui/git-core';
import type { OperationService } from '../operation-service.js';

const getActor = (request: { authUser: { role: UserRole } | null }): string =>
  request.authUser === null ? 'local-user' : `role:${request.authUser.role}`;

const assertRole = (role: UserRole, minimum: 'editor' | 'admin'): void => {
  if (minimum === 'admin' && role !== 'admin') {
    throw new GitWebUiError('PERMISSION_DENIED', '该操作需要 Admin 角色。');
  }
  if (minimum === 'editor' && role === 'viewer') {
    throw new GitWebUiError('PERMISSION_DENIED', '该操作需要 Editor 或 Admin 角色。');
  }
};

export const registerManagementRoutes = async (
  app: FastifyInstance,
  operations: OperationService,
  gitProvider: GitProvider,
  role: UserRole,
): Promise<void> => {
  app.post<{ Params: { id: string } }>('/api/repositories/:id/remotes', async (request) => {
    assertRole(role, 'admin');
    const input = remoteAddInputSchema.parse(request.body);
    return await operations.runManagementOperation(
      request.params.id,
      'remote-add',
      input,
      (repositoryPath) =>
        gitProvider.addRemote(repositoryPath, input.name, input.fetchUrl, input.pushUrl),
      false,
      getActor(request),
    );
  });

  app.patch<{ Params: { id: string } }>('/api/repositories/:id/remotes', async (request) => {
    assertRole(role, 'admin');
    const input = remoteSetUrlInputSchema.parse(request.body);
    return await operations.runManagementOperation(
      request.params.id,
      'remote-set-url',
      input,
      (repositoryPath) =>
        gitProvider.setRemoteUrl(repositoryPath, input.name, input.url, input.push),
      false,
      getActor(request),
    );
  });

  app.delete<{ Params: { id: string } }>('/api/repositories/:id/remotes', async (request) => {
    assertRole(role, 'admin');
    const input = remoteRemoveInputSchema.parse(request.body);
    return await operations.runManagementOperation(
      request.params.id,
      'remote-remove',
      input,
      (repositoryPath) => gitProvider.removeRemote(repositoryPath, input.name),
      false,
      getActor(request),
    );
  });

  app.post<{ Params: { id: string } }>('/api/repositories/:id/branches', async (request) => {
    assertRole(role, 'editor');
    const input = branchCreateInputSchema.parse(request.body);
    return await operations.runManagementOperation(
      request.params.id,
      'branch-create',
      input,
      (repositoryPath) => gitProvider.createBranch(repositoryPath, input.name, input.startPoint),
      false,
      getActor(request),
    );
  });

  app.post<{ Params: { id: string } }>('/api/repositories/:id/branches/switch', async (request) => {
    assertRole(role, 'editor');
    const input = branchSwitchInputSchema.parse(request.body);
    return await operations.runManagementOperation(
      request.params.id,
      'branch-switch',
      input,
      (repositoryPath) => gitProvider.switchBranch(repositoryPath, input.name),
      true,
      getActor(request),
    );
  });

  app.patch<{ Params: { id: string } }>('/api/repositories/:id/branches', async (request) => {
    assertRole(role, 'editor');
    const input = branchRenameInputSchema.parse(request.body);
    return await operations.runManagementOperation(
      request.params.id,
      'branch-rename',
      input,
      (repositoryPath) => gitProvider.renameBranch(repositoryPath, input.oldName, input.newName),
      false,
      getActor(request),
    );
  });

  app.delete<{ Params: { id: string } }>('/api/repositories/:id/branches', async (request) => {
    assertRole(role, 'editor');
    const input = branchDeleteInputSchema.parse(request.body);
    return await operations.runManagementOperation(
      request.params.id,
      'branch-delete',
      input,
      (repositoryPath) => gitProvider.deleteBranchSafe(repositoryPath, input.name),
      false,
      getActor(request),
    );
  });

  app.post<{ Params: { id: string } }>(
    '/api/repositories/:id/branches/upstream',
    async (request) => {
      assertRole(role, 'editor');
      const input = branchUpstreamInputSchema.parse(request.body);
      return await operations.runManagementOperation(
        request.params.id,
        'branch-set-upstream',
        input,
        (repositoryPath) =>
          gitProvider.setUpstream(
            repositoryPath,
            input.localBranch,
            input.remote,
            input.remoteBranch,
          ),
        false,
        getActor(request),
      );
    },
  );
};
