import { useEffect, useMemo, useRef } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { CommitSummary } from '@git-webui/shared';
import { EmptyState } from '@git-webui/ui-components';
import { getCommits } from './api.js';

interface HistoryViewProps {
  repositoryId: string | null;
  refName: string;
  selectedCommit: string | null;
  onSelectCommit: (hash: string) => void;
}

interface CommitGraphModel {
  lane: number;
  laneCount: number;
  secondaryLanes: number[];
}

const formatDate = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

const CommitRow = ({
  commit,
  graph,
  selected,
  onClick,
}: {
  commit: CommitSummary;
  graph: CommitGraphModel;
  selected: boolean;
  onClick: () => void;
}) => (
  <button
    className={`commit-row ${selected ? 'commit-row-selected' : ''}`}
    type="button"
    onClick={onClick}
  >
    <span className="commit-graph-column" data-parent-count={commit.parents.length}>
      {Array.from({ length: graph.laneCount }, (_, lane) => (
        <span
          className={`commit-graph-line ${lane === graph.lane ? 'commit-graph-line-active' : ''}`}
          key={`lane:${lane}`}
          style={{ left: `${13 + lane * 12}px` }}
        />
      ))}
      {graph.secondaryLanes.map((lane) => (
        <span
          className="commit-graph-edge"
          key={`edge:${lane}`}
          style={{
            left: `${13 + Math.min(graph.lane, lane) * 12}px`,
            width: `${Math.abs(graph.lane - lane) * 12}px`,
          }}
        />
      ))}
      <span className="commit-graph-node" style={{ left: `${8 + graph.lane * 12}px` }} />
    </span>
    <span className="commit-row-content">
      <span className="commit-row-main">
        <strong>{commit.subject || '(无提交说明)'}</strong>
        <code>{commit.hash.slice(0, 8)}</code>
      </span>
      <span className="commit-row-meta">
        <span>{commit.authorName}</span>
        <span>{formatDate(commit.authoredAt)}</span>
        {commit.changedFiles !== null && <span>{commit.changedFiles} files</span>}
      </span>
    </span>
  </button>
);

export const HistoryView = ({
  repositoryId,
  refName,
  selectedCommit,
  onSelectCommit,
}: HistoryViewProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const commitsQuery = useInfiniteQuery({
    queryKey: ['commits', repositoryId, refName],
    queryFn: ({ pageParam }) => getCommits(repositoryId!, refName, pageParam, 50),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.page.nextCursor ?? undefined,
    enabled: repositoryId !== null,
  });
  const commits = useMemo(
    () => commitsQuery.data?.pages.flatMap((page) => page.page.items) ?? [],
    [commitsQuery.data],
  );
  const graphModels = useMemo(() => buildCommitGraph(commits), [commits]);
  const virtualizer = useVirtualizer({
    count: commits.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 64,
    overscan: 8,
  });

  useEffect(() => {
    const lastItem = virtualizer.getVirtualItems().at(-1);
    if (
      lastItem !== undefined &&
      lastItem.index >= commits.length - 5 &&
      commitsQuery.hasNextPage &&
      !commitsQuery.isFetchingNextPage
    ) {
      void commitsQuery.fetchNextPage();
    }
  }, [commits.length, commitsQuery, virtualizer]);

  if (repositoryId === null) {
    return (
      <EmptyState
        title="选择一个仓库开始"
        description="从左侧 Locations 选择仓库，查看提交历史和工作区变更。"
      />
    );
  }
  if (commitsQuery.isPending) return <div className="center-state">加载 Commit History…</div>;
  if (commitsQuery.isError)
    return <div className="center-state center-state-error">{commitsQuery.error.message}</div>;
  if (commits.length === 0)
    return <EmptyState title="没有提交记录" description={`Ref ${refName} 暂无可显示的提交。`} />;

  return (
    <div className="history-list" ref={scrollRef}>
      <div className="virtual-list" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualizer.getVirtualItems().map((item) => {
          const commit = commits[item.index];
          if (commit === undefined) return null;
          return (
            <div
              className="virtual-row"
              key={commit.hash}
              style={{ transform: `translateY(${item.start}px)` }}
            >
              <CommitRow
                commit={commit}
                graph={
                  graphModels.get(commit.hash) ?? { lane: 0, laneCount: 1, secondaryLanes: [] }
                }
                selected={commit.hash === selectedCommit}
                onClick={() => onSelectCommit(commit.hash)}
              />
            </div>
          );
        })}
      </div>
      {commitsQuery.isFetchingNextPage && <div className="list-loading">加载更多…</div>}
    </div>
  );
};

const buildCommitGraph = (commits: readonly CommitSummary[]): Map<string, CommitGraphModel> => {
  const lanes: string[] = [];
  const models = new Map<string, CommitGraphModel>();
  for (const commit of commits) {
    const existingLane = lanes.indexOf(commit.hash);
    const lane = existingLane < 0 ? 0 : existingLane;
    if (existingLane < 0) lanes.splice(lane, 0, commit.hash);
    const laneCountBefore = Math.max(1, lanes.length, commit.parents.length);
    lanes.splice(lane, 1, ...commit.parents);
    for (let index = lanes.length - 1; index >= 0; index -= 1) {
      if (lanes.indexOf(lanes[index] as string) !== index) lanes.splice(index, 1);
    }
    const secondaryLanes = commit.parents
      .slice(1)
      .map((parent) => lanes.indexOf(parent))
      .filter((parentLane) => parentLane >= 0);
    models.set(commit.hash, {
      lane,
      laneCount: Math.max(laneCountBefore, lanes.length),
      secondaryLanes,
    });
  }
  return models;
};
