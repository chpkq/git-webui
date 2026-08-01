import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Operation } from '@git-webui/shared';
import { Panel } from '@git-webui/ui-components';
import { cancelOperation, listOperations } from './api.js';

const statusLabel: Record<Operation['status'], string> = {
  queued: '排队',
  running: '执行中',
  success: '成功',
  failed: '失败',
  conflict: '冲突',
  cancelled: '已取消',
};

const operationLabel: Record<Operation['type'], string> = {
  stage: 'Stage',
  unstage: 'Unstage',
  fetch: 'Fetch',
  pull: 'Pull',
  push: 'Push',
  'remote-add': 'Remote Add',
  'remote-set-url': 'Remote URL',
  'remote-remove': 'Remote Remove',
  'branch-create': 'Branch Create',
  'branch-switch': 'Branch Switch',
  'branch-rename': 'Branch Rename',
  'branch-delete': 'Branch Delete',
  'branch-set-upstream': 'Set Upstream',
};

export const OperationLog = ({ repositoryId }: { repositoryId: string | null }) => {
  const queryClient = useQueryClient();
  const seenEvents = useRef(new Set<string>());
  const query = useQuery({
    queryKey: ['operations', repositoryId],
    queryFn: () => listOperations(repositoryId ?? undefined),
    enabled: repositoryId !== null,
    refetchInterval: 5000,
  });
  const cancelMutation = useMutation({
    mutationFn: cancelOperation,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['operations', repositoryId] }),
  });

  useEffect(() => {
    if (repositoryId === null) return;
    const source = new EventSource('/api/operations/events');
    const rememberEvent = (event: Event): boolean => {
      const message = event as MessageEvent<string>;
      const key = `${event.type}:${message.lastEventId}:${message.data}`;
      if (seenEvents.current.has(key)) return false;
      seenEvents.current.add(key);
      if (seenEvents.current.size > 500) {
        const oldest = seenEvents.current.values().next().value as string | undefined;
        if (oldest !== undefined) seenEvents.current.delete(oldest);
      }
      return true;
    };
    const refresh = (event: Event): void => {
      if (!rememberEvent(event)) return;
      void queryClient.invalidateQueries({ queryKey: ['operations', repositoryId] });
    };
    const refreshRepository = (event: Event): void => {
      if (!rememberEvent(event)) return;
      void queryClient.invalidateQueries({ queryKey: ['status', repositoryId] });
      void queryClient.invalidateQueries({ queryKey: ['locations', repositoryId] });
      void queryClient.invalidateQueries({ queryKey: ['commits', repositoryId] });
      void queryClient.invalidateQueries({ queryKey: ['commit-detail', repositoryId] });
    };
    source.addEventListener('operation.updated', refresh);
    source.addEventListener('repo.changed', refreshRepository);
    return () => {
      source.close();
    };
  }, [queryClient, repositoryId]);

  const operations = query.data ?? [];
  return (
    <Panel title="OPERATION LOG">
      {query.isPending ? (
        <div className="inline-state">加载操作记录…</div>
      ) : operations.length === 0 ? (
        <div className="inline-state">暂无写操作</div>
      ) : (
        <div className="operation-log-list">
          {operations.slice(0, 8).map((operation) => (
            <div className="operation-log-row" key={operation.id}>
              <span className={`operation-status operation-status-${operation.status}`}>
                {statusLabel[operation.status]}
              </span>
              <span className="operation-log-type">{operationLabel[operation.type]}</span>
              <span className="operation-log-target">
                {typeof operation.target.remote === 'string' ? `${operation.target.remote} ` : ''}
                {typeof operation.target.branch === 'string' ? operation.target.branch : ''}
              </span>
              {(operation.status === 'queued' || operation.status === 'running') &&
                (operation.type === 'fetch' ||
                  operation.type === 'pull' ||
                  operation.type === 'push') && (
                  <button
                    className="operation-cancel-button"
                    type="button"
                    disabled={cancelMutation.isPending}
                    onClick={() => cancelMutation.mutate(operation.id)}
                  >
                    取消
                  </button>
                )}
              <span className="operation-log-time">
                {new Date(operation.createdAt).toLocaleTimeString('zh-CN')}
              </span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
};
