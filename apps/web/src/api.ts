import type {
  CommitDetail,
  CommitPage,
  Locations,
  Repository,
  RepositoryStatus,
} from '@git-webui/shared';

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

export const apiRequest = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
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
