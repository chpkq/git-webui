import type {
  CommitDetail,
  CommitPage,
  DiffResult,
  Locations,
  Operation,
  Repository,
  RepositoryStatus,
} from '@git-webui/shared';

export type ManagementAction =
  | 'remote-add'
  | 'remote-set-url'
  | 'remote-remove'
  | 'branch-create'
  | 'branch-switch'
  | 'branch-rename'
  | 'branch-delete'
  | 'branch-set-upstream';

interface ApiErrorBody {
  error?: { code?: string; message?: string; requestId?: string };
}

export class ApiRequestError extends Error {
  public readonly code: string;

  public readonly requestId: string | undefined;

  public constructor(code: string, message: string, requestId?: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = code;
    this.requestId = requestId;
  }
}

export interface AuthSession {
  enabled: boolean;
  authenticated: boolean;
  role?: 'viewer' | 'editor' | 'admin';
  expiresAt?: number;
}

export const apiRequest = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const method = init?.method?.toUpperCase() ?? 'GET';
  const csrfToken =
    method === 'GET' || typeof document === 'undefined' ? null : readCookie('git_webui_csrf');
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(csrfToken === null ? {} : { 'X-CSRF-Token': csrfToken }),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
    throw new ApiRequestError(
      body.error?.code ?? 'INTERNAL_ERROR',
      body.error?.message ?? `请求失败：${response.status}`,
      body.error?.requestId,
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
};

export const getAuthSession = async (): Promise<AuthSession> =>
  await apiRequest<AuthSession>('/api/auth/me');

export const login = async (password: string): Promise<AuthSession> =>
  await apiRequest<AuthSession>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });

export const logout = async (): Promise<void> => {
  await apiRequest<void>('/api/auth/logout', { method: 'POST', body: JSON.stringify({}) });
};

export const listRepositories = async (): Promise<Repository[]> =>
  (await apiRequest<{ items: Repository[] }>('/api/repositories')).items;

export const registerRepository = async (path: string, name?: string): Promise<Repository> =>
  await apiRequest<Repository>('/api/repositories', {
    method: 'POST',
    body: JSON.stringify({ path, ...(name === undefined || name === '' ? {} : { name }) }),
  });

export const removeRepository = async (id: string): Promise<void> => {
  await apiRequest<void>(`/api/repositories/${encodeURIComponent(id)}`, { method: 'DELETE' });
};

export const getRepositoryStatus = async (
  id: string,
): Promise<{ repository: Repository; status: RepositoryStatus }> =>
  await apiRequest<{ repository: Repository; status: RepositoryStatus }>(
    `/api/repositories/${encodeURIComponent(id)}/status`,
  );

export const getRepositoryLocations = async (
  id: string,
): Promise<{ repository: Repository; locations: Locations }> =>
  await apiRequest<{ repository: Repository; locations: Locations }>(
    `/api/repositories/${encodeURIComponent(id)}/locations`,
  );

export const getCommits = async (
  id: string,
  ref: string,
  cursor?: string,
  limit = 50,
): Promise<{ repository: Repository; page: CommitPage }> => {
  const params = new URLSearchParams({ ref, limit: String(limit) });
  if (cursor !== undefined) params.set('cursor', cursor);
  return await apiRequest<{ repository: Repository; page: CommitPage }>(
    `/api/repositories/${encodeURIComponent(id)}/commits?${params.toString()}`,
  );
};

export const getCommitDetail = async (
  id: string,
  commitish: string,
): Promise<{ repository: Repository; detail: CommitDetail }> =>
  await apiRequest<{ repository: Repository; detail: CommitDetail }>(
    `/api/repositories/${encodeURIComponent(id)}/commits/${encodeURIComponent(commitish)}`,
  );

export const getDiff = async (
  id: string,
  query: {
    kind: 'working' | 'staged' | 'commit' | 'compare';
    path: string;
    ref?: string;
    baseRef?: string;
  },
): Promise<{ repository: Repository; diff: DiffResult }> => {
  const params = new URLSearchParams({ kind: query.kind, path: query.path });
  if (query.ref !== undefined) params.set('ref', query.ref);
  if (query.baseRef !== undefined) params.set('baseRef', query.baseRef);
  return await apiRequest<{ repository: Repository; diff: DiffResult }>(
    `/api/repositories/${encodeURIComponent(id)}/diff?${params.toString()}`,
  );
};

export const runStage = async (
  id: string,
  action: 'stage' | 'unstage',
  paths: string[],
): Promise<Operation> =>
  await apiRequest<Operation>(`/api/repositories/${encodeURIComponent(id)}/${action}`, {
    method: 'POST',
    body: JSON.stringify({ paths }),
  });

export const runSync = async (
  id: string,
  action: 'fetch' | 'pull' | 'push',
  target: Record<string, unknown>,
): Promise<Operation> =>
  await apiRequest<Operation>(`/api/repositories/${encodeURIComponent(id)}/${action}`, {
    method: 'POST',
    body: JSON.stringify(target),
  });

export const runManagement = async (
  id: string,
  action: ManagementAction,
  target: Record<string, unknown>,
): Promise<Operation> => {
  const route =
    action === 'remote-add'
      ? `/api/repositories/${encodeURIComponent(id)}/remotes`
      : action === 'remote-set-url'
        ? `/api/repositories/${encodeURIComponent(id)}/remotes`
        : action === 'remote-remove'
          ? `/api/repositories/${encodeURIComponent(id)}/remotes`
          : action === 'branch-switch'
            ? `/api/repositories/${encodeURIComponent(id)}/branches/switch`
            : action === 'branch-set-upstream'
              ? `/api/repositories/${encodeURIComponent(id)}/branches/upstream`
              : `/api/repositories/${encodeURIComponent(id)}/branches`;
  const method =
    action === 'remote-set-url' || action === 'branch-rename'
      ? 'PATCH'
      : action === 'remote-remove' || action === 'branch-delete'
        ? 'DELETE'
        : 'POST';
  return await apiRequest<Operation>(route, {
    method,
    body: JSON.stringify(target),
  });
};

export const listOperations = async (repositoryId?: string): Promise<Operation[]> => {
  const params =
    repositoryId === undefined ? '' : `?repositoryId=${encodeURIComponent(repositoryId)}`;
  return await apiRequest<Operation[]>(`/api/operations${params}`);
};

const readCookie = (name: string): string | null => {
  const encodedName = `${name}=`;
  const cookie = document.cookie.split('; ').find((item) => item.startsWith(encodedName));
  return cookie === undefined ? null : decodeURIComponent(cookie.slice(encodedName.length));
};
