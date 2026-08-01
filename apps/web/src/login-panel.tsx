import { useState } from 'react';

interface LoginPanelProps {
  busy: boolean;
  error: string | null;
  onSubmit: (password: string) => void;
}

export const LoginPanel = ({ busy, error, onSubmit }: LoginPanelProps) => {
  const [password, setPassword] = useState('');
  return (
    <div className="login-shell">
      <form
        className="login-card"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(password);
        }}
      >
        <div className="brand-mark login-mark">G</div>
        <div className="modal-kicker">GIT WEBUI</div>
        <h1>登录本地 Git 工作区</h1>
        <p>当前服务启用了远程访问安全门禁，请使用服务端配置的登录密码。</p>
        <label className="form-field">
          <span>登录密码</span>
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        {error !== null && <div className="form-error">{error}</div>}
        <button className="primary-button login-submit" type="submit" disabled={busy}>
          {busy ? '登录中…' : '登录'}
        </button>
      </form>
    </div>
  );
};
