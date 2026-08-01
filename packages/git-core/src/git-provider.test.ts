import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CommandRunner, type CommandResult, type CommandRunnerOptions } from './command-runner.js';
import { GitProvider } from './git-provider.js';

const runGit = async (cwd: string, args: string[]): Promise<void> => {
  const result = await new CommandRunner().run({ cwd, args });
  if (result.exitCode !== 0) throw new Error(result.stderr);
};

describe('GitProvider', () => {
  it('reads a real repository status and locations', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'git-webui-provider-'));
    const repositoryPath = path.join(root, 'repository');
    await mkdir(repositoryPath);
    try {
      await runGit(repositoryPath, ['init', '-b', 'main']);
      await runGit(repositoryPath, ['config', 'user.name', '测试用户']);
      await runGit(repositoryPath, ['config', 'user.email', 'test@example.com']);
      await writeFile(path.join(repositoryPath, 'readme.txt'), 'initial\n');
      await writeFile(path.join(repositoryPath, '中文 文件.txt'), 'rename me\n');
      await runGit(repositoryPath, ['add', '--', '.']);
      await runGit(repositoryPath, ['commit', '-m', '初始提交']);
      await runGit(repositoryPath, ['mv', '--', '中文 文件.txt', '重命名 文件.txt']);
      await writeFile(path.join(repositoryPath, 'readme.txt'), 'changed\n');
      await writeFile(path.join(repositoryPath, '未跟踪\n文件.txt'), 'untracked\n');

      const provider = new GitProvider({ allowedRoots: [root] });
      const status = await provider.getStatus(repositoryPath);
      const locations = await provider.getLocations(repositoryPath);

      expect(status.branch).toBe('main');
      expect(status.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: 'readme.txt', unstaged: true }),
          expect.objectContaining({ kind: 'rename', path: '重命名 文件.txt' }),
          expect.objectContaining({ kind: 'untracked', path: '未跟踪\n文件.txt' }),
        ]),
      );
      expect(locations.branches).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'main', current: true })]),
      );
      const commits = await provider.getCommitPage(repositoryPath, 'HEAD', 0, 10);
      expect(commits.items).toHaveLength(1);
      expect(commits.items[0]).toMatchObject({ subject: '初始提交', changedFiles: 2 });
      const detail = await provider.getCommitDetail(
        repositoryPath,
        commits.items[0]?.hash ?? 'HEAD',
      );
      expect(detail.changedFiles).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: 'readme.txt', additions: 1 })]),
      );
      const untrackedDiff = await provider.readDiff(repositoryPath, 'working', '未跟踪\n文件.txt');
      expect(untrackedDiff.content).toContain('new file mode');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('读取状态时不会因外部 Git 遗留 index.lock 失败', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'git-webui-provider-lock-'));
    const repositoryPath = path.join(root, 'repository');
    await mkdir(repositoryPath);
    try {
      await runGit(repositoryPath, ['init', '-b', 'main']);
      await writeFile(path.join(repositoryPath, '.git', 'index.lock'), '');

      const provider = new GitProvider({ allowedRoots: [root] });
      await expect(provider.getStatus(repositoryPath)).resolves.toMatchObject({ branch: 'main' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    [
      'authentication failure',
      "fatal: could not read Username for 'https://example.com': terminal prompts disabled",
      'AUTH_REQUIRED',
    ],
    ['host key failure', 'Host key verification failed.', 'HOST_KEY_REQUIRED'],
    [
      'network failure',
      "fatal: unable to access 'https://example.com/repo.git': Could not resolve host",
      'GIT_COMMAND_FAILED',
    ],
  ])('maps %s to a stable error code', async (_name, stderr, code) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'git-webui-error-map-'));
    const repositoryPath = path.join(root, 'repository');
    await mkdir(repositoryPath);
    try {
      await runGit(repositoryPath, ['init', '-b', 'main']);
      const provider = new GitProvider({
        allowedRoots: [root],
        runner: new FailingRunner(stderr),
      });
      await expect(
        provider.pushExplicit(repositoryPath, 'origin', 'main', false),
      ).rejects.toMatchObject({
        code,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects a repository outside allowedRoots and a symlink escape', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'git-webui-allowed-'));
    const outside = await mkdtemp(path.join(os.tmpdir(), 'git-webui-outside-'));
    const linkPath = path.join(root, 'linked-repository');
    try {
      await runGit(outside, ['init', '-b', 'main']);
      await symlink(outside, linkPath, 'dir');
      const provider = new GitProvider({ allowedRoots: [root] });

      await expect(provider.validateRepository(outside)).rejects.toMatchObject({
        code: 'REPOSITORY_NOT_ALLOWED',
      });
      await expect(provider.validateRepository(linkPath)).rejects.toMatchObject({
        code: 'REPOSITORY_NOT_ALLOWED',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});

class FailingRunner extends CommandRunner {
  public constructor(private readonly failure: string) {
    super();
  }

  public override async run(options: CommandRunnerOptions): Promise<CommandResult> {
    if (options.args[0] === 'rev-parse' && options.args[1] === '--show-toplevel') {
      return {
        command: 'git',
        args: options.args,
        exitCode: 0,
        stdout: `${options.cwd}\n`,
        stderr: '',
        stdoutBytes: options.cwd.length + 1,
        stderrBytes: 0,
        truncated: false,
      };
    }
    return {
      command: 'git',
      args: options.args,
      exitCode: 128,
      stdout: '',
      stderr: this.failure,
      stdoutBytes: 0,
      stderrBytes: Buffer.byteLength(this.failure),
      truncated: false,
    };
  }
}
