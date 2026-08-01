import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { HealthResponse, Repository } from '@git-webui/shared';
import { StatusPill } from '@git-webui/ui-components';
import {
  apiRequest,
  getRepositoryLocations,
  getRepositoryStatus,
  listRepositories,
  registerRepository,
  removeRepository,
} from './api.js';
import { HistoryView } from './history-view.js';
import { LocationsPanel } from './locations-panel.js';
import { RegisterDialog } from './register-dialog.js';
import { SummaryPanel } from './summary-panel.js';
import { WorkingCopyView } from './working-copy-view.js';
import { useWorkspaceStore } from './workspace-store.js';

const fetchHealth = async (): Promise<HealthResponse> =>
  await apiRequest<HealthResponse>('/health');

function App() {
  const queryClient = useQueryClient();
  const [registerOpen, setRegisterOpen] = useState(false);
  const { repositoryId, ref, commitHash, view, setRepositoryId, setRef, setCommitHash, setView } =
    useWorkspaceStore();
  const health = useQuery({ queryKey: ['health'], queryFn: fetchHealth, refetchInterval: 10_000 });
  const repositoriesQuery = useQuery({ queryKey: ['repositories'], queryFn: listRepositories });
  const locationsQuery = useQuery({
    queryKey: ['locations', repositoryId],
    queryFn: () => getRepositoryLocations(repositoryId!),
    enabled: repositoryId !== null,
  });
  const statusQuery = useQuery({
    queryKey: ['status', repositoryId],
    queryFn: () => getRepositoryStatus(repositoryId!),
    enabled: repositoryId !== null,
    refetchInterval: 3000,
  });
  const registerMutation = useMutation({
    mutationFn: ({ path, name }: { path: string; name: string }) => registerRepository(path, name),
    onSuccess: (repository) => {
      void queryClient.invalidateQueries({ queryKey: ['repositories'] });
      setRepositoryId(repository.id);
      setRegisterOpen(false);
    },
  });
  const removeMutation = useMutation({
    mutationFn: (repository: Repository) => removeRepository(repository.id),
    onSuccess: (_result, repository) => {
      if (repository.id === repositoryId) setRepositoryId(null);
      void queryClient.invalidateQueries({ queryKey: ['repositories'] });
    },
  });
  const repositories = repositoriesQuery.data;
  const selectedRepository = useMemo(
    () => repositories?.find((repository) => repository.id === repositoryId),
    [repositories, repositoryId],
  );

  useEffect(() => {
    if (repositories === undefined) return;
    if (repositories.length === 0) {
      if (repositoryId !== null) setRepositoryId(null);
      return;
    }
    if (
      repositoryId === null ||
      !repositories.some((repository) => repository.id === repositoryId)
    ) {
      setRepositoryId(repositories[0]?.id ?? null);
    }
  }, [repositories, repositoryId, setRepositoryId]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (repositoryId !== null) params.set('repo', repositoryId);
    if (ref !== 'HEAD') params.set('ref', ref);
    if (commitHash !== null) params.set('commit', commitHash);
    const query = params.toString();
    window.history.replaceState(null, '', query === '' ? window.location.pathname : `?${query}`);
  }, [repositoryId, ref, commitHash]);

  const registerError =
    registerMutation.error instanceof Error ? registerMutation.error.message : null;
  const handleRemove = (repository: Repository): void => {
    if (window.confirm(`移除“${repository.name}”的注册？磁盘上的仓库不会被删除。`)) {
      removeMutation.mutate(repository);
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark">G</div>
          <div>
            <div className="brand-name">Git WebUI</div>
            <div className="brand-caption">Working Tree Client</div>
          </div>
        </div>
        <div className="toolbar-group">
          <button className="toolbar-button" type="button" onClick={() => setRegisterOpen(true)}>
            <span>＋</span> 注册仓库
          </button>
          <button className="toolbar-button" type="button" disabled>
            更新
          </button>
          <div className="toolbar-divider" />
          <button className="icon-button" type="button" aria-label="设置" disabled>
            ⚙
          </button>
        </div>
      </header>

      <main className="workspace">
        <aside className="locations-column">
          <LocationsPanel
            repositories={repositories}
            selectedRepositoryId={repositoryId}
            locations={locationsQuery.data?.locations}
            loading={locationsQuery.isPending}
            onSelectRepository={setRepositoryId}
            onSelectRef={setRef}
            onRegister={() => setRegisterOpen(true)}
            onRemove={handleRemove}
          />
        </aside>

        <section className="history-column">
          <div className="view-tabs" role="tablist" aria-label="工作区视图">
            <button
              className={`view-tab ${view === 'history' ? 'view-tab-active' : ''}`}
              type="button"
              role="tab"
              aria-selected={view === 'history'}
              onClick={() => setView('history')}
            >
              HISTORY
            </button>
            <button
              className={`view-tab ${view === 'working' ? 'view-tab-active' : ''}`}
              type="button"
              role="tab"
              aria-selected={view === 'working'}
              onClick={() => setView('working')}
            >
              WORKING COPY
            </button>
          </div>
          <div className="history-content">
            {view === 'history' ? (
              <HistoryView
                repositoryId={repositoryId}
                refName={ref}
                selectedCommit={commitHash}
                onSelectCommit={setCommitHash}
              />
            ) : (
              <WorkingCopyView
                repositoryId={repositoryId}
                status={statusQuery.data?.status}
                loading={statusQuery.isPending}
                error={statusQuery.isError ? statusQuery.error.message : null}
              />
            )}
          </div>
        </section>

        <aside className="detail-column">
          <SummaryPanel repositoryId={repositoryId} commitHash={commitHash} />
        </aside>
      </main>

      <footer className="statusbar">
        <div className="statusbar-left">
          <StatusPill tone={health.isSuccess ? 'success' : 'muted'}>
            {health.isPending ? '连接中' : health.isSuccess ? '服务正常' : '服务未连接'}
          </StatusPill>
          <span>
            {selectedRepository?.name ?? '未选择仓库'}
            {statusQuery.data?.status.branch !== null &&
            statusQuery.data?.status.branch !== undefined
              ? ` · ${statusQuery.data.status.branch}`
              : ''}
            {statusQuery.data?.status.dirty ? ' · 有未提交变更' : ''}
          </span>
        </div>
        <div className="statusbar-right">V0.1 · M2</div>
      </footer>

      {registerOpen && (
        <RegisterDialog
          busy={registerMutation.isPending}
          error={registerError}
          onClose={() => setRegisterOpen(false)}
          onSubmit={(path, name) => registerMutation.mutate({ path, name })}
        />
      )}
    </div>
  );
}

export default App;
