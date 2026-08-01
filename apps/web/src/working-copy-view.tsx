import { useEffect, useMemo, useState } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FileStatus, RepositoryStatus } from '@git-webui/shared';
import { EmptyState } from '@git-webui/ui-components';
import { getDiff, runStage } from './api.js';

interface WorkingCopyViewProps {
  repositoryId: string | null;
  status: RepositoryStatus | undefined;
  loading: boolean;
  error: string | null;
  canWrite: boolean;
}

const entryLabel = (entry: FileStatus): string => {
  if (entry.kind === 'untracked') return 'U';
  if (entry.kind === 'rename') return 'R';
  if (entry.kind === 'conflict') return 'C';
  if (entry.indexStatus === 'A' || entry.worktreeStatus === 'A') return 'A';
  if (entry.indexStatus === 'D' || entry.worktreeStatus === 'D') return 'D';
  return 'M';
};

const languageForPath = (filePath: string): string => {
  const extension = filePath.split('.').at(-1)?.toLowerCase();
  if (extension === 'ts' || extension === 'tsx') return 'typescript';
  if (extension === 'js' || extension === 'jsx') return 'javascript';
  if (extension === 'json') return 'json';
  if (extension === 'md') return 'markdown';
  if (extension === 'css') return 'css';
  return 'plaintext';
};

const DiffPane = ({
  repositoryId,
  entry,
  sideBySide,
}: {
  repositoryId: string;
  entry: FileStatus;
  sideBySide: boolean;
}) => {
  const kind = entry.staged && !entry.unstaged ? 'staged' : 'working';
  const diffQuery = useQuery({
    queryKey: ['diff', repositoryId, kind, entry.path],
    queryFn: () => getDiff(repositoryId, { kind, path: entry.path }),
  });
  if (diffQuery.isPending) return <div className="diff-state">加载 Diff…</div>;
  if (diffQuery.isError)
    return <div className="diff-state diff-state-error">{diffQuery.error.message}</div>;
  const diff = diffQuery.data?.diff;
  if (diff === undefined) return <div className="diff-state">Diff 为空</div>;
  if (diff.binary) return <div className="diff-state">Binary 文件，无法在文本 Diff 中展示。</div>;
  if (diff.lfsPointer)
    return <div className="diff-state">LFS pointer 文件；实际对象由 Git LFS 管理。</div>;
  if (diff.oversize || diff.truncated) {
    return <div className="diff-state">Diff 超过大小上限（{diff.bytes} bytes），已截断。</div>;
  }
  if (diff.content === '')
    return <div className="diff-state">该文件当前没有可展示的文本 Diff。</div>;
  return (
    <div className="monaco-diff">
      <DiffEditor
        original=""
        modified={diff.content}
        language={languageForPath(entry.path)}
        theme="vs-dark"
        options={{
          readOnly: true,
          renderSideBySide: sideBySide,
          minimap: { enabled: false },
          wordWrap: 'on',
        }}
      />
    </div>
  );
};

const FileGroup = ({
  title,
  entries,
  selectedPath,
  onSelect,
}: {
  title: string;
  entries: FileStatus[];
  selectedPath: string | null;
  onSelect: (entry: FileStatus) => void;
}) => (
  <div className="working-group">
    <div className="working-group-title">
      <span>{title}</span>
      <span>{entries.length}</span>
    </div>
    {entries.length === 0 ? (
      <div className="working-empty">空</div>
    ) : (
      entries.map((entry) => (
        <button
          className={`working-file-row ${entry.path === selectedPath ? 'working-file-row-selected' : ''}`}
          type="button"
          key={`${entry.kind}:${entry.path}`}
          onClick={() => onSelect(entry)}
        >
          <span className={`file-status file-status-${entry.kind}`}>{entryLabel(entry)}</span>
          <span className="working-file-path">{entry.path}</span>
          <span className="working-file-state">{entry.staged && entry.unstaged ? '二者' : ''}</span>
        </button>
      ))
    )}
  </div>
);

export const WorkingCopyView = ({
  repositoryId,
  status,
  loading,
  error,
  canWrite,
}: WorkingCopyViewProps) => {
  const queryClient = useQueryClient();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [sideBySide, setSideBySide] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('git-webui-diff-layout') === 'split';
  });
  const entries = useMemo(
    () => status?.entries.filter((entry) => entry.kind !== 'ignored') ?? [],
    [status],
  );
  const staged = useMemo(() => entries.filter((entry) => entry.staged), [entries]);
  const changes = useMemo(
    () => entries.filter((entry) => entry.unstaged && !entry.staged && entry.kind !== 'untracked'),
    [entries],
  );
  const untracked = useMemo(() => entries.filter((entry) => entry.kind === 'untracked'), [entries]);
  const selectedEntry = entries.find((entry) => entry.path === selectedPath) ?? entries[0];
  const stageMutation = useMutation({
    mutationFn: ({ action, paths }: { action: 'stage' | 'unstage'; paths: string[] }) =>
      runStage(repositoryId!, action, paths),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['status', repositoryId] });
      void queryClient.invalidateQueries({ queryKey: ['diff', repositoryId] });
    },
  });

  const submitStage = (action: 'stage' | 'unstage', paths: string[]): void => {
    if (!canWrite || paths.length === 0) return;
    const verb = action === 'stage' ? 'Stage' : 'Unstage';
    if (!window.confirm(`${verb} ${paths.length} 个文件？`)) return;
    stageMutation.mutate({ action, paths });
  };

  useEffect(() => {
    if (selectedPath !== null && entries.some((entry) => entry.path === selectedPath)) return;
    setSelectedPath(entries[0]?.path ?? null);
  }, [entries, selectedPath]);

  if (repositoryId === null)
    return <EmptyState title="选择一个仓库开始" description="Working Copy 需要先选择仓库。" />;
  if (loading) return <div className="center-state">读取 Working Copy…</div>;
  if (error !== null) return <div className="center-state center-state-error">{error}</div>;
  if (status === undefined) return <div className="center-state">Working Copy 为空</div>;
  if (entries.length === 0)
    return <EmptyState title="工作区干净" description="没有 staged、changes 或 untracked 文件。" />;

  const operationError =
    stageMutation.data?.status === 'success' ? null : (stageMutation.data?.error ?? null);
  return (
    <div className="working-copy-layout">
      <div className="working-sidebar">
        <div className="working-toolbar">
          <button
            className="small-action-button"
            type="button"
            disabled={!canWrite || stageMutation.isPending || changes.length === 0}
            onClick={() =>
              submitStage(
                'stage',
                changes.map((entry) => entry.path),
              )
            }
          >
            Stage All
          </button>
          <button
            className="small-action-button"
            type="button"
            disabled={!canWrite || stageMutation.isPending || staged.length === 0}
            onClick={() =>
              submitStage(
                'unstage',
                staged.map((entry) => entry.path),
              )
            }
          >
            Unstage All
          </button>
        </div>
        {operationError !== null && <div className="working-error">{operationError.message}</div>}
        <FileGroup
          title="STAGED"
          entries={staged}
          selectedPath={selectedPath}
          onSelect={setSelectedPathEntry(setSelectedPath)}
        />
        <FileGroup
          title="CHANGES"
          entries={changes}
          selectedPath={selectedPath}
          onSelect={setSelectedPathEntry(setSelectedPath)}
        />
        <FileGroup
          title="UNTRACKED"
          entries={untracked}
          selectedPath={selectedPath}
          onSelect={setSelectedPathEntry(setSelectedPath)}
        />
      </div>
      <div className="working-diff-pane">
        {selectedEntry === undefined ? (
          <div className="diff-state">选择文件查看 Diff</div>
        ) : (
          <>
            <div className="diff-header">
              <span>{selectedEntry.path}</span>
              <span className="diff-header-actions">
                <button
                  className="small-action-button"
                  type="button"
                  onClick={() => {
                    const next = !sideBySide;
                    setSideBySide(next);
                    window.localStorage.setItem(
                      'git-webui-diff-layout',
                      next ? 'split' : 'unified',
                    );
                  }}
                >
                  {sideBySide ? 'Unified' : 'Split'}
                </button>
                <button
                  className="small-action-button"
                  type="button"
                  disabled={!canWrite || stageMutation.isPending}
                  onClick={() =>
                    submitStage(selectedEntry.staged ? 'unstage' : 'stage', [selectedEntry.path])
                  }
                >
                  {selectedEntry.staged ? 'Unstage' : 'Stage'}
                </button>
              </span>
            </div>
            <DiffPane repositoryId={repositoryId} entry={selectedEntry} sideBySide={sideBySide} />
          </>
        )}
      </div>
    </div>
  );
};

const setSelectedPathEntry =
  (setSelectedPath: (path: string) => void) =>
  (entry: FileStatus): void => {
    setSelectedPath(entry.path);
  };
