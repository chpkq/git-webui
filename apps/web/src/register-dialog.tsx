import { useState } from 'react';

interface RegisterDialogProps {
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (path: string, name: string) => void;
}

export const RegisterDialog = ({ busy, error, onClose, onSubmit }: RegisterDialogProps) => {
  const [path, setPath] = useState('');
  const [name, setName] = useState('');

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <form
        className="modal-card"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(path, name);
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <div className="modal-kicker">LOCATIONS</div>
            <h2>注册本地仓库</h2>
          </div>
          <button className="modal-close" type="button" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <label className="form-field">
          <span>仓库路径</span>
          <input
            autoFocus
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder="/Users/you/src/project"
            required
          />
          <small>必须位于服务端配置的 allowedRoots 内。</small>
        </label>
        <label className="form-field">
          <span>显示名称（可选）</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="默认使用仓库目录名"
          />
        </label>
        {error !== null && <div className="form-error">{error}</div>}
        <div className="modal-actions">
          <button className="secondary-button" type="button" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button className="primary-button" type="submit" disabled={busy}>
            {busy ? '验证中…' : '注册仓库'}
          </button>
        </div>
      </form>
    </div>
  );
};
