import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CommandRunner } from './command-runner.js';
import {
  validateCommitish,
  validateGitName,
  validateGitUrl,
  validateRelativePath,
} from './path-security.js';
import { GitProvider } from './git-provider.js';

const runGit = async (cwd: string, args: string[]): Promise<void> => {
  const result = await new CommandRunner().run({ cwd, args });
  if (result.exitCode !== 0) throw new Error(result.stderr);
};

describe('Git security and edge boundaries', () => {
  it('rejects malicious ref/path/name inputs and reads detached multi-remote locations', async () => {
    expectError(() => validateCommitish('-bad'), 'INVALID_REF');
    expectError(() => validateCommitish('main branch'), 'INVALID_REF');
    expectError(() => validateGitName('-origin', 'remote'), 'INVALID_REMOTE');
    expectError(() => validateGitName('feature..bad', 'branch'), 'INVALID_BRANCH');
    expectError(() => validateRelativePath('../outside.txt'), 'INVALID_PATH');
    expectError(() => validateRelativePath('.git/config'), 'INVALID_PATH');
    expectError(() => validateGitName('host:/tmp/repo.git', 'remote'), 'INVALID_REMOTE');
    expectError(() => validateGitName(':feature', 'branch'), 'INVALID_BRANCH');
    expectError(() => validateGitName('+main:main', 'branch'), 'INVALID_BRANCH');
    expectError(
      () => validateGitUrl('https://user:secret@example.com/repo.git'),
      'INVALID_REQUEST',
    );
    expectError(
      () => validateGitUrl('https://example.com/repo.git?token=secret'),
      'INVALID_REQUEST',
    );

    const root = await mkdtemp(path.join(os.tmpdir(), 'git-webui-boundary-'));
    const repositoryPath = path.join(root, 'repository');
    await mkdir(repositoryPath);
    try {
      await runGit(repositoryPath, ['init', '-b', 'main']);
      await runGit(repositoryPath, ['config', 'user.name', '边界测试']);
      await runGit(repositoryPath, ['config', 'user.email', 'boundary@example.com']);
      await writeFile(path.join(repositoryPath, 'file.txt'), 'content\n');
      await runGit(repositoryPath, ['add', '--', 'file.txt']);
      await runGit(repositoryPath, ['commit', '-m', '边界初始提交']);
      await writeFile(path.join(repositoryPath, '.gitignore'), '.env\n');
      await runGit(repositoryPath, ['add', '--', '.gitignore']);
      await runGit(repositoryPath, ['commit', '-m', '忽略文件规则']);
      const originPath = path.join(root, 'origin.git');
      await runGit(repositoryPath, ['init', '--bare', originPath]);
      await runGit(repositoryPath, ['remote', 'add', 'origin', originPath]);
      await runGit(repositoryPath, ['remote', 'add', 'backup', '/tmp/backup.git']);
      await runGit(repositoryPath, ['switch', '--detach', 'HEAD']);

      const provider = new GitProvider({ allowedRoots: [root] });
      await writeFile(path.join(repositoryPath, '.env'), 'secret=do-not-read\n');
      await expect(
        provider.readDiff(repositoryPath, 'working', '.git/config'),
      ).rejects.toMatchObject({
        code: 'INVALID_PATH',
      });
      await expect(provider.readDiff(repositoryPath, 'working', '.env')).resolves.toMatchObject({
        content: '',
        truncated: false,
      });
      const outputPath = path.join(root, 'option-injection-output.txt');
      await expect(
        provider.readDiff(repositoryPath, 'commit', 'file.txt', `--output=${outputPath}`),
      ).rejects.toMatchObject({ code: 'INVALID_REF' });
      await expect(access(outputPath)).rejects.toThrow();
      await provider.pushExplicit(repositoryPath, 'origin', 'main', false);
      await expect(
        runGit(originPath, ['show-ref', '--verify', '--quiet', 'refs/heads/main']),
      ).resolves.toBeUndefined();
      const status = await provider.getStatus(repositoryPath);
      const locations = await provider.getLocations(repositoryPath);
      expect(status.branch).toBeNull();
      expect(locations.remotes.map((remote) => remote.name).sort()).toEqual(['backup', 'origin']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reports binary, deleted, and oversized diffs with explicit state', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'git-webui-diff-boundary-'));
    const repositoryPath = path.join(root, 'repository');
    await mkdir(repositoryPath);
    try {
      await runGit(repositoryPath, ['init', '-b', 'main']);
      await runGit(repositoryPath, ['config', 'user.name', 'Diff 边界测试']);
      await runGit(repositoryPath, ['config', 'user.email', 'diff@example.com']);
      await writeFile(path.join(repositoryPath, 'binary.bin'), Buffer.from([0, 1, 2, 3]));
      await writeFile(path.join(repositoryPath, 'deleted.txt'), 'delete me\n');
      await writeFile(path.join(repositoryPath, 'large.txt'), 'small\n');
      await runGit(repositoryPath, ['add', '--', '.']);
      await runGit(repositoryPath, ['commit', '-m', 'Diff 边界初始提交']);
      await writeFile(path.join(repositoryPath, 'binary.bin'), Buffer.from([0, 4, 5, 6]));
      await rm(path.join(repositoryPath, 'deleted.txt'));
      await writeFile(path.join(repositoryPath, 'large.txt'), 'x'.repeat(4096));

      const provider = new GitProvider({ allowedRoots: [root] });
      const binary = await provider.readDiff(repositoryPath, 'working', 'binary.bin');
      const oversized = await provider.readDiff(
        repositoryPath,
        'working',
        'large.txt',
        undefined,
        undefined,
        32,
      );
      const deletedDiff = await provider.readDiff(repositoryPath, 'working', 'deleted.txt');
      const changedFiles = await provider.getChangedFiles(repositoryPath, 'working');
      expect(binary.binary).toBe(true);
      expect(oversized.truncated).toBe(true);
      expect(oversized.bytes).toBeGreaterThan(32);
      expect(deletedDiff).toMatchObject({ originalContent: 'delete me\n', modifiedContent: '' });
      expect(changedFiles).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: 'deleted.txt', status: 'deleted' }),
        ]),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

const expectError = (action: () => unknown, code: string): void => {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toMatchObject({ code });
};
