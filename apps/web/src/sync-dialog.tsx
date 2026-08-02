import { useEffect, useState } from 'react';
import type { Locations, Operation, RepositoryStatus } from '@git-webui/shared';

export type SyncAction = 'fetch' | 'pull' | 'push';

interface SyncDialogProps {
  action: SyncAction;
  repositoryName: string;
  status: RepositoryStatus | undefined;
  locations: Locations | undefined;
  operation: Operation | undefined;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (target: Record<string, unknown>) => void;
}

const actionCopy: Record<SyncAction, { kicker: string; title: string; impact: string }> = {
  fetch: {
    kicker: 'UPDATE',
    title: 'Fetch All + Prune',
    impact: '更新所有 Remote refs，并清理已删除的远端引用。',
  },
  pull: {
    kicker: 'PULL',
    title: 'ff-only Pull',
    impact: '仅允许快进更新当前分支，不创建 Merge Commit。',
  },
  push: {
    kicker: 'PUSH',
    title: 'Push 当前分支',
    impact: '将明确选择的本地分支推送到明确 Remote。',
  },
};

export const SyncDialog = ({
  action,
  repositoryName,
  status,
  locations,
  operation,
  busy,
  error,
  onClose,
  onSubmit,
}: SyncDialogProps) => {
  const [remote, setRemote] = useState(locations?.remotes[0]?.name ?? 'origin');
  const [branch, setBranch] = useState(status?.branch ?? '');
  const [setUpstream, setSetUpstream] = useState(status?.upstream === null);
  const copy = actionCopy[action];
  const pullBlocked = action === 'pull' && (status?.dirty === true || status?.upstream === null);

  useEffect(() => {
    if (locations?.remotes[0]?.name !== undefined && remote === '')
      setRemote(locations.remotes[0].name);
    if (status?.branch !== null && status?.branch !== undefined && branch === '')
      setBranch(status.branch);
  }, [branch, locations, remote, status]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <form
        className="modal-card sync-modal-card"
        onSubmit={(event) => {
          event.preventDefault();
          if (pullBlocked || busy) return;
          onSubmit(action === 'push' ? { remote, branch, setUpstream } : {});
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <div className="modal-kicker">{copy.kicker}</div>
            <h2>{copy.title}</h2>
          </div>
          <button className="modal-close" type="button" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <div className="operation-target-card">
          <span>仓库</span>
          <strong>{repositoryName}</strong>
          <span>影响</span>
          <strong>{copy.impact}</strong>
        </div>
        {action === 'pull' && (
          <div className={`preflight-note ${pullBlocked ? 'preflight-note-warning' : ''}`}>
            {status?.dirty
              ? '当前 Working Tree 有未提交变更，Pull 会被服务端拒绝。'
              : status?.upstream === null
                ? '当前分支没有 upstream，请先设置 upstream 后再 Pull。'
                : `目标 upstream：${status?.upstream}`}
          </div>
        )}
        {action === 'push' && (
          <>
            <label className="form-field">
              <span>Remote</span>
              <select value={remote} onChange={(event) => setRemote(event.target.value)} required>
                {locations?.remotes.map((item) => (
                  <option key={item.name} value={item.name}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>Branch</span>
              <input value={branch} onChange={(event) => setBranch(event.target.value)} required />
            </label>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={setUpstream}
                onChange={(event) => setSetUpstream(event.target.checked)}
              />
              首次推送时设置 upstream
            </label>
          </>
        )}
        {operation !== undefined && (
          <div className={`operation-result operation-result-${operation.status}`}>
            <strong>
              {operation.status === 'success' ? '操作成功' : `操作${operation.status}`}
            </strong>
            {operation.progress?.text && <span>{operation.progress.text}</span>}
            {operation.error && <span>{operation.error.message}</span>}
          </div>
        )}
        {error !== null && <div className="form-error">{error}</div>}
        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onClose}>
            关闭
          </button>
          <button className="primary-button" type="submit" disabled={busy || pullBlocked}>
            {busy ? '执行中…' : '确认执行'}
          </button>
        </div>
      </form>
    </div>
  );
};
