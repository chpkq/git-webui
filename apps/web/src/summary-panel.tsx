import { useQuery } from '@tanstack/react-query';
import { EmptyState, Panel } from '@git-webui/ui-components';
import { getCommitDetail } from './api.js';

interface SummaryPanelProps {
  repositoryId: string | null;
  commitHash: string | null;
}

const formatDate = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
};

export const SummaryPanel = ({ repositoryId, commitHash }: SummaryPanelProps) => {
  const detailQuery = useQuery({
    queryKey: ['commit-detail', repositoryId, commitHash],
    queryFn: () => getCommitDetail(repositoryId!, commitHash!),
    enabled: repositoryId !== null && commitHash !== null,
  });
  const detail = detailQuery.data?.detail;

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
              <div className="changed-file-row" key={`${file.status}:${file.path}`}>
                <span className={`file-status file-status-${file.status}`}>
                  {file.status[0]?.toUpperCase()}
                </span>
                <span className="changed-file-path">{file.path}</span>
                <span className="changed-file-stats">
                  {file.binary ? 'binary' : `+${file.additions ?? '—'} -${file.deletions ?? '—'}`}
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </>
  );
};
