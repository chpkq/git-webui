import type { Locations, Repository, UserRole } from '@git-webui/shared';
import type { ReactNode } from 'react';
import { EmptyState, Panel } from '@git-webui/ui-components';

interface LocationsPanelProps {
  repositories: Repository[] | undefined;
  selectedRepositoryId: string | null;
  locations: Locations | undefined;
  loading: boolean;
  onSelectRepository: (id: string) => void;
  onSelectRef: (ref: string) => void;
  onRegister: () => void;
  onManage: () => void;
  onRemove: (repository: Repository) => void;
  role: UserRole;
}

const LocationGroup = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="location-group">
    <div className="location-group-title">{title}</div>
    {children}
  </div>
);

export const LocationsPanel = ({
  repositories,
  selectedRepositoryId,
  locations,
  loading,
  onSelectRepository,
  onSelectRef,
  onRegister,
  onManage,
  onRemove,
  role,
}: LocationsPanelProps) => (
  <Panel
    title="LOCATIONS"
    action={
      <span className="panel-actions">
        <button
          className="panel-action"
          type="button"
          onClick={onManage}
          disabled={selectedRepositoryId === null || role === 'viewer'}
          title="管理 Remote 与 Branch"
        >
          ⚙
        </button>
        <button
          className="panel-action"
          type="button"
          onClick={onRegister}
          disabled={role === 'viewer'}
          title="注册仓库"
        >
          ＋
        </button>
      </span>
    }
  >
    <div className="repository-list">
      <div className="location-section-title">仓库</div>
      {repositories === undefined ? (
        <div className="inline-state">加载仓库…</div>
      ) : repositories.length === 0 ? (
        <EmptyState
          title="还没有注册仓库"
          description="注册 allowedRoots 内的本地 Git 仓库后，仓库会显示在这里。"
        />
      ) : (
        repositories.map((repository) => (
          <div
            className={`repository-item ${repository.id === selectedRepositoryId ? 'repository-item-active' : ''}`}
            key={repository.id}
          >
            <button
              className="repository-select"
              type="button"
              onClick={() => onSelectRepository(repository.id)}
            >
              <span className="repository-icon">▰</span>
              <span className="repository-copy">
                <strong>{repository.name}</strong>
                <small>{repository.path}</small>
              </span>
            </button>
            {role !== 'viewer' && (
              <button
                className="repository-remove"
                type="button"
                title="移除注册（不会删除磁盘仓库）"
                onClick={() => onRemove(repository)}
              >
                ×
              </button>
            )}
          </div>
        ))
      )}
    </div>
    {selectedRepositoryId !== null && (
      <div className="locations-tree">
        {loading ? (
          <div className="inline-state">读取 Git Locations…</div>
        ) : locations === undefined ? (
          <div className="inline-state">Locations 暂时不可用</div>
        ) : (
          <>
            <LocationGroup title={`LOCAL BRANCHES · ${locations.branches.length}`}>
              {locations.branches.length === 0 ? (
                <div className="tree-empty">暂无本地分支</div>
              ) : (
                locations.branches.map((branch) => (
                  <button
                    className={`tree-row ${branch.current ? 'tree-row-current' : ''}`}
                    type="button"
                    key={branch.name}
                    onClick={() => onSelectRef(branch.name)}
                  >
                    <span className="tree-row-icon">{branch.current ? '●' : '○'}</span>
                    <span>{branch.name}</span>
                    {branch.current && <em>HEAD</em>}
                  </button>
                ))
              )}
            </LocationGroup>
            <LocationGroup title={`REMOTES · ${locations.remotes.length}`}>
              {locations.remotes.length === 0 ? (
                <div className="tree-empty">暂无 Remote</div>
              ) : (
                locations.remotes.map((remote) => (
                  <div className="tree-row tree-row-readonly" key={remote.name}>
                    <span className="tree-row-icon">◎</span>
                    <span>{remote.name}</span>
                  </div>
                ))
              )}
            </LocationGroup>
            <LocationGroup title={`REMOTE BRANCHES · ${locations.remoteBranches.length}`}>
              {locations.remoteBranches.map((branch) => (
                <button
                  className="tree-row"
                  type="button"
                  key={branch.name}
                  onClick={() => onSelectRef(branch.name)}
                >
                  <span className="tree-row-icon">↗</span>
                  <span>{branch.name}</span>
                </button>
              ))}
            </LocationGroup>
            <LocationGroup title={`TAGS · ${locations.tags.length}`}>
              {locations.tags.map((tag) => (
                <button
                  className="tree-row"
                  type="button"
                  key={tag.name}
                  onClick={() => onSelectRef(tag.name)}
                >
                  <span className="tree-row-icon">◆</span>
                  <span>{tag.name}</span>
                </button>
              ))}
            </LocationGroup>
            <LocationGroup title={`SUBMODULES · ${locations.submodules.length}`}>
              {locations.submodules.length === 0 ? (
                <div className="tree-empty">暂无 Submodule</div>
              ) : (
                locations.submodules.map((submodule) => (
                  <div className="tree-row tree-row-readonly" key={submodule.name}>
                    <span className="tree-row-icon">▧</span>
                    <span>{submodule.path}</span>
                  </div>
                ))
              )}
            </LocationGroup>
            <LocationGroup title={`WORKTREES · ${locations.worktrees.length}`}>
              {locations.worktrees.map((worktree) => (
                <div className="tree-row tree-row-readonly" key={worktree.path}>
                  <span className="tree-row-icon">⌂</span>
                  <span>{worktree.branch ?? worktree.path}</span>
                </div>
              ))}
            </LocationGroup>
          </>
        )}
      </div>
    )}
  </Panel>
);
