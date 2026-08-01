import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CommandRunner } from './command-runner.js';
import { GitProvider } from './git-provider.js';

const runGit = async (cwd: string, args: string[]): Promise<void> => {
  const result = await new CommandRunner().run({ cwd, args });
  if (result.exitCode !== 0) throw new Error(result.stderr);
};

describe('commit history boundaries', () => {
  it('paginates a long history and preserves decorations', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'git-webui-history-'));
    const repositoryPath = path.join(root, 'repository');
    await mkdir(repositoryPath);
    try {
      await runGit(repositoryPath, ['init', '-b', 'main']);
      await runGit(repositoryPath, ['config', 'user.name', 'History 测试']);
      await runGit(repositoryPath, ['config', 'user.email', 'history@example.com']);
      for (let index = 0; index < 60; index += 1) {
        await runGit(repositoryPath, ['commit', '--allow-empty', '-m', `history-${index}`]);
      }
      await runGit(repositoryPath, ['branch', 'merge-feature']);
      await runGit(repositoryPath, ['switch', 'merge-feature']);
      await runGit(repositoryPath, ['commit', '--allow-empty', '-m', 'merge-feature']);
      await runGit(repositoryPath, ['switch', 'main']);
      await runGit(repositoryPath, ['commit', '--allow-empty', '-m', 'merge-main']);
      await runGit(repositoryPath, ['merge', '--no-ff', 'merge-feature', '-m', 'merge commit']);
      await runGit(repositoryPath, ['tag', 'v0.1']);

      const provider = new GitProvider({ allowedRoots: [root] });
      const firstPage = await provider.getCommitPage(repositoryPath, 'HEAD', 0, 50);
      const secondPage = await provider.getCommitPage(repositoryPath, 'HEAD', 50, 50);
      expect(firstPage.items).toHaveLength(50);
      expect(firstPage.hasMore).toBe(true);
      expect(firstPage.nextCursor).toBe('50');
      expect(secondPage.items).toHaveLength(13);
      expect(secondPage.hasMore).toBe(false);
      expect(secondPage.nextCursor).toBeNull();
      expect(firstPage.items[0]?.decorations).toEqual(
        expect.arrayContaining([expect.stringContaining('tag: v0.1')]),
      );
      expect(firstPage.items[0]?.parents).toHaveLength(2);
      expect(new Set(firstPage.items.map((item) => item.hash)).size).toBe(50);
      expect(
        firstPage.items.some((item) => secondPage.items.some((other) => other.hash === item.hash)),
      ).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});
