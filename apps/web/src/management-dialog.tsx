import { useEffect, useMemo, useState } from 'react';
import type { Locations, Operation, RepositoryStatus, UserRole } from '@git-webui/shared';
import type { ManagementAction } from './api.js';

interface ManagementDialogProps {
  repositoryName: string;
  locations: Locations | undefined;
  status: RepositoryStatus | undefined;
  operation: Operation | undefined;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (action: ManagementAction, target: Record<string, unknown>) => void;
  role: UserRole;
}

const actionCopy: Record<ManagementAction, { group: string; title: string; impact: string }> = {
  'remote-add': {
    group: 'Remote',
    title: '新增 Remote',
    impact: '写入 Remote fetch URL，并可选地设置独立 push URL。',
  },
  'remote-set-url': {
    group: 'Remote',
    title: '修改 Remote URL',
    impact: '修改选定 Remote 的 fetch 或 push URL。',
  },
  'remote-remove': {
    group: 'Remote',
    title: '移除 Remote',
    impact: '从本地仓库配置中移除选定 Remote，不删除远端仓库。',
  },
  'branch-create': {
    group: 'Branch',
    title: '创建 Branch',
    impact: '从当前 HEAD 或指定 commitish 创建新的本地分支。',
  },
  'branch-switch': {
    group: 'Branch',
    title: '切换 Branch',
    impact: '切换当前 Working Tree；脏工作区和进行中的 Git 状态会被拒绝。',
  },
  'branch-rename': {
    group: 'Branch',
    title: '重命名 Branch',
    impact: '只修改本地分支名称，不改写提交历史。',
  },
  'branch-delete': {
    group: 'Branch',
    title: '安全删除 Branch',
    impact: '仅使用 Git 的 -d 安全删除规则，未合并、当前或 Worktree 分支会被拒绝。',
  },
  'branch-set-upstream': {
    group: 'Branch',
    title: '设置 upstream',
    impact: '为本地分支设置明确的 Remote Branch 跟踪关系。',
  },
};

const dangerActions = new Set<ManagementAction>(['remote-remove', 'branch-delete']);

export const ManagementDialog = ({
  repositoryName,
  locations,
  status,
  operation,
  busy,
  error,
  onClose,
  onSubmit,
  role,
}: ManagementDialogProps) => {
  const [action, setAction] = useState<ManagementAction>('branch-create');
  const [remoteName, setRemoteName] = useState('');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [remotePushUrl, setRemotePushUrl] = useState('');
  const [pushUrl, setPushUrl] = useState(false);
  const [branchName, setBranchName] = useState('');
  const [startPoint, setStartPoint] = useState('');
  const [oldBranchName, setOldBranchName] = useState('');
  const [newBranchName, setNewBranchName] = useState('');
  const [remoteBranch, setRemoteBranch] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const branches = locations?.branches ?? [];
  const remotes = locations?.remotes ?? [];
  const copy = actionCopy[action];
  const currentBranch = status?.branch ?? branches.find((branch) => branch.current)?.name ?? '';

  useEffect(() => {
    if (remoteName === '' && remotes[0] !== undefined) setRemoteName(remotes[0].name);
    if (oldBranchName === '' && branches[0] !== undefined) setOldBranchName(branches[0].name);
    if (branchName === '' && currentBranch !== '') setBranchName(currentBranch);
    if (remoteBranch === '' && currentBranch !== '') setRemoteBranch(currentBranch);
  }, [branchName, branches, currentBranch, oldBranchName, remoteBranch, remoteName, remotes]);

  const requiresConfirmation = dangerActions.has(action);
  const canSubmit = !busy && (!requiresConfirmation || confirmed);
  const targetSummary = useMemo(() => {
    switch (action) {
      case 'remote-add':
        return `${remoteName || '未命名'} · ${remoteUrl || '未设置 URL'}`;
      case 'remote-set-url':
        return `${remoteName || '未选择 Remote'} · ${pushUrl ? 'push' : 'fetch'} URL`;
      case 'remote-remove':
        return remoteName || '未选择 Remote';
      case 'branch-create':
        return `${branchName || '未命名'}${startPoint ? ` ← ${startPoint}` : ''}`;
      case 'branch-switch':
        return branchName || '未选择 Branch';
      case 'branch-rename':
        return `${oldBranchName || '未选择 Branch'} → ${newBranchName || '未命名'}`;
      case 'branch-delete':
        return branchName || '未选择 Branch';
      case 'branch-set-upstream':
        return `${branchName || '未选择 Branch'} → ${remoteName || '未选择 Remote'}/${remoteBranch || '未命名'}`;
    }
  }, [
    action,
    branchName,
    newBranchName,
    oldBranchName,
    pushUrl,
    remoteBranch,
    remoteName,
    remoteUrl,
    startPoint,
  ]);

  const submit = (): void => {
    switch (action) {
      case 'remote-add':
        onSubmit(action, {
          name: remoteName,
          fetchUrl: remoteUrl,
          ...(remotePushUrl === '' ? {} : { pushUrl: remotePushUrl }),
        });
        return;
      case 'remote-set-url':
        onSubmit(action, { name: remoteName, url: remoteUrl, push: pushUrl });
        return;
      case 'remote-remove':
        onSubmit(action, { name: remoteName });
        return;
      case 'branch-create':
        onSubmit(action, {
          name: branchName,
          ...(startPoint === '' ? {} : { startPoint }),
        });
        return;
      case 'branch-switch':
        onSubmit(action, { name: branchName });
        return;
      case 'branch-rename':
        onSubmit(action, { oldName: oldBranchName, newName: newBranchName });
        return;
      case 'branch-delete':
        onSubmit(action, { name: branchName });
        return;
      case 'branch-set-upstream':
        onSubmit(action, {
          localBranch: branchName,
          remote: remoteName,
          remoteBranch,
        });
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <form
        className="modal-card management-modal-card"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) submit();
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <div className="modal-kicker">LOCATIONS / MANAGEMENT</div>
            <h2>{copy.title}</h2>
          </div>
          <button className="modal-close" type="button" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <label className="form-field">
          <span>操作</span>
          <select
            value={action}
            onChange={(event) => {
              setAction(event.target.value as ManagementAction);
              setConfirmed(false);
            }}
          >
            <optgroup label="Remote">
              {role === 'admin' && <option value="remote-add">新增 Remote</option>}
              {role === 'admin' && <option value="remote-set-url">修改 Remote URL</option>}
              {role === 'admin' && <option value="remote-remove">移除 Remote</option>}
            </optgroup>
            <optgroup label="Branch">
              <option value="branch-create">创建 Branch</option>
              <option value="branch-switch">切换 Branch</option>
              <option value="branch-rename">重命名 Branch</option>
              <option value="branch-delete">安全删除 Branch</option>
              <option value="branch-set-upstream">设置 upstream</option>
            </optgroup>
          </select>
        </label>

        {action === 'remote-add' && (
          <>
            <TextField label="Remote 名称" value={remoteName} onChange={setRemoteName} required />
            <TextField label="Fetch URL" value={remoteUrl} onChange={setRemoteUrl} required />
            <TextField label="Push URL（可选）" value={remotePushUrl} onChange={setRemotePushUrl} />
          </>
        )}
        {(action === 'remote-set-url' || action === 'remote-remove') && (
          <SelectField
            label="Remote"
            value={remoteName}
            options={remotes.map((remote) => ({ value: remote.name, label: remote.name }))}
            onChange={setRemoteName}
            emptyLabel="暂无 Remote"
          />
        )}
        {action === 'remote-set-url' && (
          <>
            <TextField label="URL" value={remoteUrl} onChange={setRemoteUrl} required />
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={pushUrl}
                onChange={(event) => setPushUrl(event.target.checked)}
              />
              修改 push URL（默认修改 fetch URL）
            </label>
          </>
        )}
        {action === 'branch-create' && (
          <>
            <TextField
              label="新 Branch 名称"
              value={branchName}
              onChange={setBranchName}
              required
            />
            <TextField
              label="Start point（可选）"
              value={startPoint}
              onChange={setStartPoint}
              hint="留空时从当前 HEAD 创建。"
            />
          </>
        )}
        {(action === 'branch-switch' || action === 'branch-delete') && (
          <SelectField
            label="Branch"
            value={branchName}
            options={branches.map((branch) => ({
              value: branch.name,
              label: `${branch.name}${branch.current ? ' · 当前' : ''}`,
            }))}
            onChange={setBranchName}
            emptyLabel="暂无本地 Branch"
          />
        )}
        {action === 'branch-rename' && (
          <>
            <SelectField
              label="原 Branch"
              value={oldBranchName}
              options={branches.map((branch) => ({ value: branch.name, label: branch.name }))}
              onChange={setOldBranchName}
              emptyLabel="暂无本地 Branch"
            />
            <TextField
              label="新 Branch 名称"
              value={newBranchName}
              onChange={setNewBranchName}
              required
            />
          </>
        )}
        {action === 'branch-set-upstream' && (
          <>
            <SelectField
              label="本地 Branch"
              value={branchName}
              options={branches.map((branch) => ({ value: branch.name, label: branch.name }))}
              onChange={setBranchName}
              emptyLabel="暂无本地 Branch"
            />
            <SelectField
              label="Remote"
              value={remoteName}
              options={remotes.map((remote) => ({ value: remote.name, label: remote.name }))}
              onChange={setRemoteName}
              emptyLabel="暂无 Remote"
            />
            <TextField
              label="Remote Branch"
              value={remoteBranch}
              onChange={setRemoteBranch}
              required
            />
          </>
        )}

        <div className="operation-target-card management-target-card">
          <span>仓库</span>
          <strong>{repositoryName}</strong>
          <span>目标</span>
          <strong>{targetSummary}</strong>
          <span>影响</span>
          <strong>{copy.impact}</strong>
        </div>
        {requiresConfirmation && (
          <label className="checkbox-field danger-confirmation">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            我已确认目标和影响，允许执行此操作
          </label>
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
          <button className="secondary-button" type="button" onClick={onClose} disabled={busy}>
            关闭
          </button>
          <button className="primary-button" type="submit" disabled={!canSubmit}>
            {busy ? '执行中…' : '确认执行'}
          </button>
        </div>
      </form>
    </div>
  );
};

const TextField = ({
  label,
  value,
  onChange,
  required = false,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  hint?: string;
}) => (
  <label className="form-field">
    <span>{label}</span>
    <input value={value} onChange={(event) => onChange(event.target.value)} required={required} />
    {hint !== undefined && <small>{hint}</small>}
  </label>
);

const SelectField = ({
  label,
  value,
  options,
  onChange,
  emptyLabel,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  emptyLabel: string;
}) => (
  <label className="form-field">
    <span>{label}</span>
    <select value={value} onChange={(event) => onChange(event.target.value)} required>
      {options.length === 0 ? (
        <option value="">{emptyLabel}</option>
      ) : (
        options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))
      )}
    </select>
  </label>
);
