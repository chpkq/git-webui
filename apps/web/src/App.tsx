import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FileStatus, HealthResponse, Repository } from '@git-webui/shared';
import { StatusPill } from '@git-webui/ui-components';
import {
  apiRequest,
  getAuthSession,
  getRepositoryLocations,
  getRepositoryStatus,
  listRepositories,
  registerRepository,
  removeRepository,
  runManagement,
  runSync,
  login,
  logout,
  type ManagementAction,
} from './api.js';
import { HistoryView } from './history-view.js';
import { LocationsPanel } from './locations-panel.js';
import { RegisterDialog } from './register-dialog.js';
import { SummaryPanel } from './summary-panel.js';
import { SyncDialog, type SyncAction } from './sync-dialog.js';
import { ManagementDialog } from './management-dialog.js';
import { BranchSwitchDialog } from './branch-switch-dialog.js';
import { LoginPanel } from './login-panel.js';
import { WorkingCopyDiffPanel, WorkingCopyView } from './working-copy-view.js';
import { useRepositoryEvents } from './repository-events.js';
import { useWorkspaceStore } from './workspace-store.js';

const fetchHealth = async (): Promise<HealthResponse> =>
  await apiRequest<HealthResponse>('/health');

interface WorkspaceLayout {
  locations: number;
  history: number;
}

const DEFAULT_WORKSPACE_LAYOUT: WorkspaceLayout = { locations: 260, history: 520 };

const readWorkspaceLayout = (): WorkspaceLayout => {
  if (typeof window === 'undefined') return DEFAULT_WORKSPACE_LAYOUT;
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem('git-webui-layout') ?? 'null',
    ) as Partial<WorkspaceLayout> | null;
    return {
      locations:
        typeof parsed?.locations === 'number'
          ? clamp(parsed.locations, 210, 420)
          : DEFAULT_WORKSPACE_LAYOUT.locations,
      history:
        typeof parsed?.history === 'number'
          ? clamp(parsed.history, 360, 900)
          : DEFAULT_WORKSPACE_LAYOUT.history,
    };
  } catch {
    return DEFAULT_WORKSPACE_LAYOUT;
  }
};

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

function App() {
  const queryClient = useQueryClient();
  const [registerOpen, setRegisterOpen] = useState(false);
  const [syncAction, setSyncAction] = useState<SyncAction | null>(null);
  const [managementOpen, setManagementOpen] = useState(false);
  const [branchSwitchTarget, setBranchSwitchTarget] = useState<string | null>(null);
  const [workspaceLayout, setWorkspaceLayout] = useState<WorkspaceLayout>(readWorkspaceLayout);
  const [detailSidebarActivated, setDetailSidebarActivated] = useState(false);
  const [workingCopyPath, setWorkingCopyPath] = useState<string | null>(null);
  const { repositoryId, ref, commitHash, view, setRepositoryId, setRef, setCommitHash, setView } =
    useWorkspaceStore();
  const authQuery = useQuery({ queryKey: ['auth'], queryFn: getAuthSession, staleTime: 60_000 });
  const authenticated = authQuery.data?.authenticated === true;
  const role = authQuery.data?.role ?? 'admin';
  const appEnabled = authQuery.data !== undefined && (!authQuery.data.enabled || authenticated);
  const health = useQuery({ queryKey: ['health'], queryFn: fetchHealth, refetchInterval: 10_000 });
  const repositoriesQuery = useQuery({
    queryKey: ['repositories'],
    queryFn: listRepositories,
    enabled: appEnabled,
  });
  const locationsQuery = useQuery({
    queryKey: ['locations', repositoryId],
    queryFn: () => getRepositoryLocations(repositoryId!),
    enabled: appEnabled && repositoryId !== null,
  });
  const statusQuery = useQuery({
    queryKey: ['status', repositoryId],
    queryFn: () => getRepositoryStatus(repositoryId!),
    enabled: appEnabled && repositoryId !== null,
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
  const loginMutation = useMutation({
    mutationFn: login,
    onSuccess: () => void authQuery.refetch(),
  });
  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      void queryClient.clear();
      void authQuery.refetch();
    },
  });
  const removeMutation = useMutation({
    mutationFn: (repository: Repository) => removeRepository(repository.id),
    onSuccess: (_result, repository) => {
      if (repository.id === repositoryId) setRepositoryId(null);
      void queryClient.invalidateQueries({ queryKey: ['repositories'] });
    },
  });
  const refreshRepositoryQueries = async (): Promise<void> => {
    if (repositoryId === null) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['status', repositoryId] }),
      queryClient.invalidateQueries({ queryKey: ['locations', repositoryId] }),
      queryClient.invalidateQueries({ queryKey: ['commits', repositoryId] }),
    ]);
  };
  const updateRefAfterBranchSwitch = (
    operation: { status: string; result: Record<string, unknown> | null },
    fallbackBranch: string,
  ): void => {
    if (operation.status !== 'success') return;
    const resultBranch = operation.result?.branch;
    setRef(typeof resultBranch === 'string' && resultBranch !== '' ? resultBranch : fallbackBranch);
  };
  const syncMutation = useMutation({
    mutationFn: ({ action, target }: { action: SyncAction; target: Record<string, unknown> }) =>
      runSync(repositoryId!, action, target),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['status', repositoryId] });
      void queryClient.invalidateQueries({ queryKey: ['locations', repositoryId] });
      void queryClient.invalidateQueries({ queryKey: ['commits', repositoryId] });
    },
  });
  const managementMutation = useMutation({
    mutationFn: ({
      action,
      target,
    }: {
      action: ManagementAction;
      target: Record<string, unknown>;
    }) => runManagement(repositoryId!, action, target),
    onSuccess: async (operation, variables) => {
      await refreshRepositoryQueries();
      if (variables.action === 'branch-switch' && typeof variables.target.name === 'string') {
        updateRefAfterBranchSwitch(operation, variables.target.name);
      }
    },
  });
  const branchSwitchMutation = useMutation({
    mutationFn: (name: string) => runManagement(repositoryId!, 'branch-switch', { name }),
    onSuccess: async (operation, name) => {
      await refreshRepositoryQueries();
      updateRefAfterBranchSwitch(operation, name);
    },
  });
  const repositories = repositoriesQuery.data;
  const selectedRepository = useMemo(
    () => repositories?.find((repository) => repository.id === repositoryId),
    [repositories, repositoryId],
  );
  const workingCopyEntries = useMemo<FileStatus[]>(
    () => statusQuery.data?.status.entries.filter((entry) => entry.kind !== 'ignored') ?? [],
    [statusQuery.data?.status.entries],
  );
  const selectedWorkingCopyEntry = useMemo(
    () => workingCopyEntries.find((entry) => entry.path === workingCopyPath),
    [workingCopyEntries, workingCopyPath],
  );

  useRepositoryEvents(repositoryId);

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
    if (
      workingCopyPath !== null &&
      workingCopyEntries.some((entry) => entry.path === workingCopyPath)
    ) {
      return;
    }
    setWorkingCopyPath(workingCopyEntries[0]?.path ?? null);
  }, [workingCopyEntries, workingCopyPath]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (repositoryId !== null) params.set('repo', repositoryId);
    if (ref !== 'HEAD') params.set('ref', ref);
    if (commitHash !== null) params.set('commit', commitHash);
    const query = params.toString();
    window.history.replaceState(null, '', query === '' ? window.location.pathname : `?${query}`);
  }, [repositoryId, ref, commitHash]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || repositoryId === null) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable
      ) {
        return;
      }
      const actions: Record<string, SyncAction> = { u: 'fetch', p: 'pull', s: 'push' };
      const action = actions[event.key.toLowerCase()];
      if (action === undefined || role === 'viewer') return;
      event.preventDefault();
      setSyncAction(action);
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [repositoryId, role]);

  const registerError =
    registerMutation.error instanceof Error ? registerMutation.error.message : null;
  const handleRemove = (repository: Repository): void => {
    if (window.confirm(`移除“${repository.name}”的注册？磁盘上的仓库不会被删除。`)) {
      removeMutation.mutate(repository);
    }
  };

  const handleSelectRef = (nextRef: string): void => {
    if (repositoryId !== null && nextRef !== ref) {
      void queryClient.cancelQueries({ queryKey: ['commits', repositoryId] });
    }
    setRef(nextRef);
  };

  const handleRequestSwitchBranch = (branchName: string): void => {
    branchSwitchMutation.reset();
    setBranchSwitchTarget(branchName);
  };

  const closeBranchSwitchDialog = (): void => {
    if (branchSwitchMutation.isPending) return;
    branchSwitchMutation.reset();
    setBranchSwitchTarget(null);
  };

  const startResize = (
    kind: 'locations' | 'history',
    event: ReactPointerEvent<HTMLDivElement>,
  ): void => {
    event.preventDefault();
    const initialX = event.clientX;
    const initialLayout = workspaceLayout;
    const onMove = (moveEvent: PointerEvent): void => {
      const delta = moveEvent.clientX - initialX;
      const nextLayout = {
        ...initialLayout,
        [kind]: clamp(
          initialLayout[kind] + delta,
          kind === 'locations' ? 210 : 360,
          kind === 'locations' ? 420 : 900,
        ),
      };
      setWorkspaceLayout(nextLayout);
      window.localStorage.setItem('git-webui-layout', JSON.stringify(nextLayout));
    };
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
    };
    document.body.style.cursor = 'col-resize';
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  };

  if (authQuery.isPending)
    return <div className="center-state app-loading-state">验证服务状态…</div>;
  if (authQuery.isError)
    return (
      <div className="center-state center-state-error app-loading-state">
        {authQuery.error.message}
      </div>
    );
  if (authQuery.data?.enabled && !authenticated) {
    return (
      <LoginPanel
        busy={loginMutation.isPending}
        error={loginMutation.error instanceof Error ? loginMutation.error.message : null}
        onSubmit={(password) => loginMutation.mutate(password)}
      />
    );
  }

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
          <button
            className="toolbar-button"
            type="button"
            onClick={() => setRegisterOpen(true)}
            disabled={role === 'viewer'}
          >
            <span>＋</span> 注册仓库
          </button>
          <button
            className="toolbar-button"
            type="button"
            disabled={repositoryId === null || role === 'viewer'}
            onClick={() => setSyncAction('fetch')}
          >
            更新
          </button>
          <button
            className="toolbar-button"
            type="button"
            disabled={repositoryId === null || role === 'viewer'}
            onClick={() => setSyncAction('pull')}
          >
            Pull
          </button>
          <button
            className="toolbar-button"
            type="button"
            disabled={repositoryId === null || role === 'viewer'}
            onClick={() => setSyncAction('push')}
          >
            Push
          </button>
          {authQuery.data?.enabled && (
            <button
              className="toolbar-button"
              type="button"
              onClick={() => logoutMutation.mutate()}
              disabled={logoutMutation.isPending}
            >
              退出
            </button>
          )}
          <div className="toolbar-divider" />
          <button className="icon-button" type="button" aria-label="设置" disabled>
            ⚙
          </button>
        </div>
      </header>

      <main
        className="workspace"
        style={
          {
            '--locations-width': `${workspaceLayout.locations}px`,
            '--history-width': `${workspaceLayout.history}px`,
          } as CSSProperties
        }
      >
        <aside className="locations-column">
          <LocationsPanel
            repositories={repositories}
            selectedRepositoryId={repositoryId}
            locations={locationsQuery.data?.locations}
            currentBranch={statusQuery.data?.status.branch}
            loading={locationsQuery.isPending}
            onSelectRepository={setRepositoryId}
            onSelectRef={handleSelectRef}
            onRequestSwitchBranch={handleRequestSwitchBranch}
            onRegister={() => setRegisterOpen(true)}
            onManage={() => {
              managementMutation.reset();
              setManagementOpen(true);
            }}
            onRemove={handleRemove}
            role={role}
          />
        </aside>
        <div
          className="workspace-resizer"
          role="separator"
          aria-label="调整 Locations 宽度"
          onPointerDown={(event) => startResize('locations', event)}
        />

        <section className="history-column">
          <div className="view-tabs" role="tablist" aria-label="工作区视图">
            <button
              className={`view-tab ${view === 'history' ? 'view-tab-active' : ''}`}
              type="button"
              role="tab"
              aria-selected={view === 'history'}
              onClick={() => {
                setDetailSidebarActivated(true);
                setView('history');
              }}
            >
              HISTORY
            </button>
            <button
              className={`view-tab ${view === 'working' ? 'view-tab-active' : ''}`}
              type="button"
              role="tab"
              aria-selected={view === 'working'}
              onClick={() => {
                setDetailSidebarActivated(true);
                setView('working');
              }}
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
                canWrite={role !== 'viewer'}
                selectedPath={workingCopyPath}
                onSelectPath={setWorkingCopyPath}
              />
            )}
          </div>
        </section>
        <div
          className="workspace-resizer"
          role="separator"
          aria-label="调整 History 宽度"
          onPointerDown={(event) => startResize('history', event)}
        />

        <aside
          className={`detail-column ${
            detailSidebarActivated ? `detail-column-${view}` : 'detail-column-empty'
          }`}
        >
          {detailSidebarActivated && view === 'history' && (
            <SummaryPanel repositoryId={repositoryId} commitHash={commitHash} />
          )}
          {detailSidebarActivated && view === 'working' && (
            <WorkingCopyDiffPanel
              repositoryId={repositoryId}
              entry={selectedWorkingCopyEntry}
              canWrite={role !== 'viewer'}
            />
          )}
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
        <div className="statusbar-right">V0.1 · M6</div>
      </footer>

      {registerOpen && (
        <RegisterDialog
          busy={registerMutation.isPending}
          error={registerError}
          onClose={() => setRegisterOpen(false)}
          onSubmit={(path, name) => registerMutation.mutate({ path, name })}
        />
      )}
      {branchSwitchTarget !== null && selectedRepository !== undefined && (
        <BranchSwitchDialog
          repositoryName={selectedRepository.name}
          branchName={branchSwitchTarget}
          operation={branchSwitchMutation.data}
          busy={branchSwitchMutation.isPending}
          error={
            branchSwitchMutation.error instanceof Error ? branchSwitchMutation.error.message : null
          }
          onClose={closeBranchSwitchDialog}
          onSubmit={() => branchSwitchMutation.mutate(branchSwitchTarget)}
        />
      )}
      {syncAction !== null && selectedRepository !== undefined && (
        <SyncDialog
          action={syncAction}
          repositoryName={selectedRepository.name}
          status={statusQuery.data?.status}
          locations={locationsQuery.data?.locations}
          operation={syncMutation.data}
          busy={syncMutation.isPending}
          error={syncMutation.error instanceof Error ? syncMutation.error.message : null}
          onClose={() => {
            syncMutation.reset();
            setSyncAction(null);
          }}
          onSubmit={(target) => syncMutation.mutate({ action: syncAction, target })}
        />
      )}
      {managementOpen && selectedRepository !== undefined && (
        <ManagementDialog
          repositoryName={selectedRepository.name}
          locations={locationsQuery.data?.locations}
          status={statusQuery.data?.status}
          operation={managementMutation.data}
          busy={managementMutation.isPending}
          error={
            managementMutation.error instanceof Error ? managementMutation.error.message : null
          }
          role={role}
          onClose={() => {
            managementMutation.reset();
            setManagementOpen(false);
          }}
          onSubmit={(action, target) => managementMutation.mutate({ action, target })}
        />
      )}
    </div>
  );
}

export default App;
