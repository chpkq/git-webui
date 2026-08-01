import { describe, expect, it } from 'vitest';
import type { Locations, RepositoryStatus } from '@git-webui/shared';
import { RepositoryWatcher } from './repository-watcher.js';
import type { RepositoryService } from './repository-service.js';

const status: RepositoryStatus = {
  head: 'a'.repeat(40),
  branch: 'main',
  upstream: null,
  ahead: 0,
  behind: 0,
  dirty: false,
  entries: [],
  inProgress: [],
};

const locations: Locations = {
  branches: [],
  remotes: [],
  remoteBranches: [],
  tags: [],
  submodules: [],
  worktrees: [],
};

describe('RepositoryWatcher', () => {
  it('debounces external repository changes into repo.changed events', async () => {
    let currentStatus = status;
    const service = {
      list: () => [{ id: 'repository-1' }],
      getStatus: async () => ({ repository: { id: 'repository-1' }, status: currentStatus }),
      getLocations: async () => ({ repository: { id: 'repository-1' }, locations }),
    } as unknown as RepositoryService;
    const watcher = new RepositoryWatcher(service, 10);
    const events: string[] = [];
    const unsubscribe = watcher.subscribe((event) => events.push(event.repositoryId));
    watcher.start();
    await wait(150);
    currentStatus = { ...status, dirty: true };
    await wait(180);
    watcher.stop();
    unsubscribe();
    expect(events).toEqual(['repository-1']);
  });
});

const wait = async (milliseconds: number): Promise<void> =>
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
