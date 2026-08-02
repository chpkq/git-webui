import type { Operation } from '@git-webui/shared';

interface BranchSwitchDialogProps {
  repositoryName: string;
  branchName: string;
  operation: Operation | undefined;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: () => void;
}

export const BranchSwitchDialog = ({
  repositoryName,
  branchName,
  operation,
  busy,
  error,
  onClose,
  onSubmit,
}: BranchSwitchDialogProps) => {
  const finished = operation !== undefined;

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <form
        className="modal-card branch-switch-modal-card"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && !finished) onSubmit();
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <div className="modal-kicker">LOCATIONS / BRANCH</div>
            <h2>切换当前分支</h2>
          </div>
          <button
            className="modal-close"
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="关闭"
          >
            ×
          </button>
        </div>
        <p className="branch-switch-question">是否切换当前分支到该分支？</p>
        <div className="operation-target-card branch-switch-target-card">
          <span>仓库</span>
          <strong>{repositoryName}</strong>
          <span>目标分支</span>
          <strong>{branchName}</strong>
          <span>影响</span>
          <strong>切换真实 Working Tree；脏工作区或进行中的 Git 状态会被拒绝。</strong>
        </div>
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
          <button className="secondary-button" type="button" onClick={onClose} disabled={busy}>
            关闭
          </button>
          <button className="primary-button" type="submit" disabled={busy || finished}>
            {busy ? '执行中…' : '确认切换'}
          </button>
        </div>
      </form>
    </div>
  );
};
