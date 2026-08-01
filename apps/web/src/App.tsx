import { useQuery } from '@tanstack/react-query';
import { EmptyState, Panel, StatusPill } from '@git-webui/ui-components';
import type { HealthResponse } from '@git-webui/shared';

const fetchHealth = async (): Promise<HealthResponse> => {
  const response = await fetch('/health');
  if (!response.ok) {
    throw new Error(`健康检查失败：${response.status}`);
  }
  return (await response.json()) as HealthResponse;
};

function App() {
  const health = useQuery({ queryKey: ['health'], queryFn: fetchHealth, refetchInterval: 10_000 });

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
          <button className="toolbar-button" type="button" disabled>
            <span>＋</span> 注册仓库
          </button>
          <button className="toolbar-button" type="button" disabled>
            更新
          </button>
          <div className="toolbar-divider" />
          <button className="icon-button" type="button" aria-label="设置" disabled>
            ⚙
          </button>
        </div>
      </header>

      <main className="workspace">
        <aside className="locations-column">
          <Panel
            title="LOCATIONS"
            action={
              <button className="panel-action" type="button">
                ⌕
              </button>
            }
          >
            <div className="location-section-title">仓库</div>
            <EmptyState
              title="还没有注册仓库"
              description="注册 allowedRoots 内的本地 Git 仓库后，仓库会显示在这里。"
            />
          </Panel>
        </aside>

        <section className="history-column">
          <div className="view-tabs" role="tablist" aria-label="工作区视图">
            <button
              className="view-tab view-tab-active"
              type="button"
              role="tab"
              aria-selected="true"
            >
              HISTORY
            </button>
            <button className="view-tab" type="button" role="tab" aria-selected="false">
              WORKING COPY
            </button>
          </div>
          <div className="history-content">
            <EmptyState
              title="选择一个仓库开始"
              description="从左侧 Locations 选择仓库，查看提交历史和工作区变更。"
            />
          </div>
        </section>

        <aside className="detail-column">
          <Panel title="SUMMARY">
            <EmptyState
              title="暂无选中内容"
              description="选择提交或文件后，在这里查看摘要和 Diff。"
            />
          </Panel>
          <Panel title="DIFF" className="diff-panel">
            <div className="diff-placeholder">Diff Viewer</div>
          </Panel>
        </aside>
      </main>

      <footer className="statusbar">
        <div className="statusbar-left">
          <StatusPill tone={health.isSuccess ? 'success' : 'muted'}>
            {health.isPending ? '连接中' : health.isSuccess ? '服务正常' : '服务未连接'}
          </StatusPill>
          <span>本机模式 · 只监听 127.0.0.1</span>
        </div>
        <div className="statusbar-right">V0.1 · M0</div>
      </footer>
    </div>
  );
}

export default App;
