import { Fragment, useEffect, useState } from 'react';
import { DiffEditor } from '@monaco-editor/react';
import { useQuery } from '@tanstack/react-query';
import { EmptyState, Panel } from '@git-webui/ui-components';
import { getCommitDetail, getDiff } from './api.js';
import { createDiffEditorOptions, DiffVisibilityToggle } from './diff-view-controls.js';
import './monaco-config.js';

interface SummaryPanelProps {
  repositoryId: string | null;
  commitHash: string | null;
}

const formatDate = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
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

const CommitFileDiff = ({
  repositoryId,
  commitHash,
  path,
}: {
  repositoryId: string;
  commitHash: string;
  path: string;
}) => {
  const [showFullFile, setShowFullFile] = useState(false);
  const fileDiffQuery = useQuery({
    queryKey: ['commit-diff', repositoryId, commitHash, path],
    queryFn: () =>
      getDiff(repositoryId, {
        kind: 'commit',
        path,
        ref: commitHash,
      }),
  });

  return (
    <div className="commit-file-diff">
      <div className="commit-file-diff-title">
        <DiffVisibilityToggle
          showFullFile={showFullFile}
          onToggle={() => setShowFullFile((current) => !current)}
        />
        <span>Diff · {path}</span>
      </div>
      {fileDiffQuery.isPending ? (
        <div className="diff-placeholder">加载文件 Diff…</div>
      ) : fileDiffQuery.isError ? (
        <div className="inline-state inline-state-error">{fileDiffQuery.error.message}</div>
      ) : fileDiffQuery.data?.diff.binary ? (
        <div className="diff-placeholder">Binary 文件，无法在文本 Diff 中展示。</div>
      ) : fileDiffQuery.data?.diff.truncated ? (
        <div className="diff-placeholder">Diff 超过大小上限，已截断。</div>
      ) : fileDiffQuery.data?.diff.content === '' ? (
        <div className="diff-placeholder">该文件没有可展示的 Diff。</div>
      ) : (
        <div className="monaco-diff commit-file-diff-editor">
          <DiffEditor
            original={fileDiffQuery.data?.diff.originalContent ?? ''}
            modified={fileDiffQuery.data?.diff.modifiedContent ?? ''}
            language={languageForPath(path)}
            theme="vs-dark"
            options={createDiffEditorOptions({ renderSideBySide: false, showFullFile })}
          />
        </div>
      )}
    </div>
  );
};

export const SummaryPanel = ({ repositoryId, commitHash }: SummaryPanelProps) => {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const detailQuery = useQuery({
    queryKey: ['commit-detail', repositoryId, commitHash],
    queryFn: () => getCommitDetail(repositoryId!, commitHash!),
    enabled: repositoryId !== null && commitHash !== null,
  });
  const detail = detailQuery.data?.detail;

  useEffect(() => {
    setSelectedPath(null);
  }, [commitHash]);

  return (
    <>
      <Panel title="SUMMARY">
        {commitHash === null ? (
          <EmptyState
            title="暂无选中内容"
            description="选择提交或文件后，在这里查看摘要和 Diff。"
          />
        ) : detailQuery.isPending ? (
          <div className="inline-state">加载 Commit Detail…</div>
        ) : detailQuery.isError ? (
          <div className="inline-state inline-state-error">{detailQuery.error.message}</div>
        ) : detail === undefined ? (
          <div className="inline-state">Commit Detail 为空</div>
        ) : (
          <div className="summary-content">
            <h3>{detail.commit.subject}</h3>
            <div className="summary-hash">{detail.commit.hash}</div>
            <dl className="summary-meta">
              <dt>作者</dt>
              <dd>
                {detail.commit.authorName} &lt;{detail.commit.authorEmail}&gt;
              </dd>
              <dt>时间</dt>
              <dd>{formatDate(detail.commit.authoredAt)}</dd>
              <dt>父提交</dt>
              <dd>
                {detail.commit.parents.length === 0
                  ? '无（根提交）'
                  : detail.commit.parents.join(', ')}
              </dd>
              <dt>变更</dt>
              <dd>
                {detail.changedFiles.length} files · +{detail.commit.additions ?? '—'} / -
                {detail.commit.deletions ?? '—'}
              </dd>
            </dl>
            {detail.body.trim() !== '' && <pre className="commit-body">{detail.body.trim()}</pre>}
          </div>
        )}
      </Panel>
      <Panel title="CHANGED FILES" className="diff-panel">
        {detail === undefined ? (
          <div className="diff-placeholder">选择 Commit 后加载文件</div>
        ) : detail.changedFiles.length === 0 ? (
          <div className="diff-placeholder">没有文件变更</div>
        ) : (
          <div className="changed-file-list">
            {detail.changedFiles.map((file) => (
              <Fragment key={`${file.status}:${file.path}`}>
                <button
                  className={`changed-file-row ${file.path === selectedPath ? 'changed-file-row-selected' : ''}`}
                  type="button"
                  aria-expanded={file.path === selectedPath}
                  onClick={() =>
                    setSelectedPath((currentPath) => (currentPath === file.path ? null : file.path))
                  }
                >
                  <span className={`file-status file-status-${file.status}`}>
                    {file.status[0]?.toUpperCase()}
                  </span>
                  <span className="changed-file-path">{file.path}</span>
                  <span className="changed-file-stats">
                    {file.binary ? 'binary' : `+${file.additions ?? '—'} -${file.deletions ?? '—'}`}
                  </span>
                </button>
                {file.path === selectedPath && repositoryId !== null && commitHash !== null && (
                  <CommitFileDiff
                    repositoryId={repositoryId}
                    commitHash={commitHash}
                    path={file.path}
                  />
                )}
              </Fragment>
            ))}
          </div>
        )}
      </Panel>
    </>
  );
};
