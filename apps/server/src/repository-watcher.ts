import { EventEmitter } from 'node:events';
import { GitWebUiError, type RepositoryStatus } from '@git-webui/shared';
import type { Locations } from '@git-webui/shared';
import type { RepositoryService } from './repository-service.js';

export interface RepositoryChangedEvent {
  type: 'repo.changed';
  repositoryId: string;
  changedAt: string;
}

type RepositoryListener = (event: RepositoryChangedEvent) => void;

export class RepositoryWatcher {
  private readonly events = new EventEmitter();

  private readonly fingerprints = new Map<string, string>();

  private readonly pending = new Map<string, NodeJS.Timeout>();

  private timer: NodeJS.Timeout | undefined;

  private polling = false;

  public constructor(
    private readonly repositoryService: RepositoryService,
    private readonly intervalMs = 2500,
  ) {}

  public start(): void {
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => void this.poll(), this.intervalMs);
    void this.poll();
  }

  public stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    for (const timer of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
  }

  public subscribe(listener: RepositoryListener): () => void {
    this.events.on('changed', listener);
    return () => this.events.off('changed', listener);
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const repositories = this.repositoryService.list();
      const knownIds = new Set(repositories.map((repository) => repository.id));
      for (const repositoryId of this.fingerprints.keys()) {
        if (!knownIds.has(repositoryId)) this.fingerprints.delete(repositoryId);
      }
      await Promise.all(repositories.map(async (repository) => this.pollRepository(repository.id)));
    } finally {
      this.polling = false;
    }
  }

  private async pollRepository(repositoryId: string): Promise<void> {
    let fingerprint: string;
    try {
      const [statusResult, locationsResult] = await Promise.all([
        this.repositoryService.getStatus(repositoryId),
        this.repositoryService.getLocations(repositoryId),
      ]);
      fingerprint = JSON.stringify({
        status: fingerprintStatus(statusResult.status),
        locations: fingerprintLocations(locationsResult.locations),
      });
    } catch (error) {
      fingerprint = JSON.stringify({ error: errorCode(error) });
    }
    const previous = this.fingerprints.get(repositoryId);
    this.fingerprints.set(repositoryId, fingerprint);
    if (previous !== undefined && previous !== fingerprint) this.scheduleEvent(repositoryId);
  }

  private scheduleEvent(repositoryId: string): void {
    if (this.pending.has(repositoryId)) return;
    const timer = setTimeout(() => {
      this.pending.delete(repositoryId);
      this.events.emit('changed', {
        type: 'repo.changed',
        repositoryId,
        changedAt: new Date().toISOString(),
      } satisfies RepositoryChangedEvent);
    }, 120);
    this.pending.set(repositoryId, timer);
  }
}

const fingerprintStatus = (status: RepositoryStatus): Record<string, unknown> => ({
  head: status.head,
  branch: status.branch,
  upstream: status.upstream,
  ahead: status.ahead,
  behind: status.behind,
  dirty: status.dirty,
  inProgress: status.inProgress,
  entries: status.entries,
});

const fingerprintLocations = (locations: Locations): Record<string, unknown> => ({
  branches: locations.branches,
  remotes: locations.remotes,
  remoteBranches: locations.remoteBranches,
  tags: locations.tags,
  submodules: locations.submodules,
  worktrees: locations.worktrees,
});

const errorCode = (error: unknown): string =>
  error instanceof GitWebUiError ? error.code : 'INTERNAL_ERROR';
