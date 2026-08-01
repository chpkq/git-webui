import { access } from 'node:fs/promises';
import path from 'node:path';
import {
  GitWebUiError,
  type Branch,
  type ChangedFile,
  type Locations,
  type Remote,
  type RemoteBranch,
  type RepositoryStatus,
  type Submodule,
  type Tag,
  type Worktree,
} from '@git-webui/shared';
import { CommandRunner, redactSensitiveText, type CommandResult } from './command-runner.js';
import {
  parsePorcelainV2,
  toRepositoryStatus,
  type ParsedPorcelainStatus,
} from './porcelain-parser.js';
import {
  validateGitName,
  validateRelativePath,
  validateRepositoryPath,
  type ValidatedRepository,
} from './path-security.js';

const RECORD_SEPARATOR = '\u001e';

export interface GitProviderOptions {
  allowedRoots: readonly string[];
  runner?: CommandRunner;
}

export interface GitCommitRecord {
  hash: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  authoredAt: string;
  subject: string;
  body: string;
  decorations: string[];
}

export class GitProvider {
  public readonly runner: CommandRunner;

  private readonly allowedRoots: readonly string[];

  public constructor(options: GitProviderOptions) {
    this.allowedRoots = options.allowedRoots;
    this.runner = options.runner ?? new CommandRunner();
  }

  public async validateRepository(repositoryPath: string): Promise<ValidatedRepository> {
    return await validateRepositoryPath(repositoryPath, this.allowedRoots, this.runner);
  }

  private async execute(repositoryPath: string, args: readonly string[]): Promise<CommandResult> {
    const validated = await this.validateRepository(repositoryPath);
    return await this.runner.run({
      cwd: validated.path,
      args,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GCM_INTERACTIVE: 'Never',
      },
    });
  }

  private async executeChecked(
    repositoryPath: string,
    args: readonly string[],
  ): Promise<CommandResult> {
    const result = await this.execute(repositoryPath, args);
    if (result.exitCode !== 0) {
      throw this.mapCommandFailure(result);
    }
    return result;
  }

  private mapCommandFailure(result: CommandResult): GitWebUiError {
    const stderr = redactSensitiveText(result.stderr).trim();
    const lower = stderr.toLowerCase();
    if (
      result.exitCode === 128 &&
      (lower.includes('authentication') || lower.includes('could not read username'))
    ) {
      return new GitWebUiError(
        'AUTH_REQUIRED',
        'Git 远程操作需要外部凭据，但当前进程不能交互输入。',
      );
    }
    if (lower.includes('host key verification failed')) {
      return new GitWebUiError('HOST_KEY_REQUIRED', 'Git 远程主机未通过 SSH Host Key 校验。');
    }
    if (lower.includes('non-fast-forward') || lower.includes('fetch first')) {
      return new GitWebUiError('NON_FAST_FORWARD', '远程分支不是本地分支的快进目标。');
    }
    if (lower.includes('conflict') || lower.includes('automatic merge failed')) {
      return new GitWebUiError('CONFLICT', 'Git 操作产生冲突，需要在外部 Git 工具中处理。');
    }
    return new GitWebUiError('GIT_COMMAND_FAILED', stderr.slice(0, 4000) || 'Git 命令执行失败。', {
      exitCode: result.exitCode,
    });
  }

  public async getStatus(repositoryPath: string): Promise<RepositoryStatus> {
    const result = await this.executeChecked(repositoryPath, [
      'status',
      '--porcelain=v2',
      '-z',
      '--branch',
    ]);
    const parsed = parsePorcelainV2(result.stdout);
    const inProgress = await this.getInProgressState(repositoryPath);
    return toRepositoryStatus(parsed, inProgress);
  }

  private async getParsedStatus(repositoryPath: string): Promise<ParsedPorcelainStatus> {
    const result = await this.executeChecked(repositoryPath, [
      'status',
      '--porcelain=v2',
      '-z',
      '--branch',
    ]);
    return parsePorcelainV2(result.stdout);
  }

  public async getInProgressState(repositoryPath: string): Promise<RepositoryStatus['inProgress']> {
    const validated = await this.validateRepository(repositoryPath);
    const gitDirResult = await this.runner.run({
      cwd: validated.path,
      args: ['rev-parse', '--git-dir'],
    });
    if (gitDirResult.exitCode !== 0) {
      return [];
    }
    const gitDir = path.isAbsolute(gitDirResult.stdout.trim())
      ? gitDirResult.stdout.trim()
      : path.resolve(validated.path, gitDirResult.stdout.trim());
    const states: RepositoryStatus['inProgress'] = [];
    if (await pathExists(path.join(gitDir, 'MERGE_HEAD'))) states.push('merge');
    if (
      (await pathExists(path.join(gitDir, 'rebase-merge'))) ||
      (await pathExists(path.join(gitDir, 'rebase-apply')))
    ) {
      states.push('rebase');
    }
    if (await pathExists(path.join(gitDir, 'CHERRY_PICK_HEAD'))) states.push('cherry-pick');
    if (await pathExists(path.join(gitDir, 'REVERT_HEAD'))) states.push('revert');
    if (await pathExists(path.join(gitDir, 'BISECT_HEAD'))) states.push('bisect');
    return states;
  }

  public async getLocations(repositoryPath: string): Promise<Locations> {
    const status = await this.getParsedStatus(repositoryPath);
    const [branches, remotes, remoteBranches, tags, submodules, worktrees] = await Promise.all([
      this.getBranches(repositoryPath, status.branch),
      this.getRemotes(repositoryPath),
      this.getRemoteBranches(repositoryPath),
      this.getTags(repositoryPath),
      this.getSubmodules(repositoryPath),
      this.getWorktrees(repositoryPath),
    ]);
    return { branches, remotes, remoteBranches, tags, submodules, worktrees };
  }

  private async getBranches(
    repositoryPath: string,
    currentBranch: string | null,
  ): Promise<Branch[]> {
    const result = await this.executeChecked(repositoryPath, [
      'for-each-ref',
      `--format=%(refname:short)%00%(objectname)%00%(upstream:short)%00%(upstream:track)%00%(worktreepath)%00${RECORD_SEPARATOR}`,
      'refs/heads',
    ]);
    return result.stdout
      .split(RECORD_SEPARATOR)
      .map((record) => record.trimEnd())
      .filter(Boolean)
      .map((record) => {
        const [name, objectId, upstream, tracking, worktreePath] = record.split('\0');
        return {
          name: name ?? '',
          objectId: objectId ?? '',
          upstream: upstream || null,
          tracking: tracking || null,
          worktreePath: worktreePath || null,
          current: name === currentBranch,
        } satisfies Branch;
      });
  }

  private async getRemotes(repositoryPath: string): Promise<Remote[]> {
    const names = (await this.executeChecked(repositoryPath, ['remote'])).stdout
      .split('\n')
      .map((name) => name.trim())
      .filter(Boolean);
    return await Promise.all(
      names.map(async (name) => {
        validateGitName(name, 'remote');
        const fetch = await this.execute(repositoryPath, ['remote', 'get-url', name]);
        const push = await this.execute(repositoryPath, ['remote', 'get-url', '--push', name]);
        return {
          name,
          fetchUrl: fetch.exitCode === 0 ? redactSensitiveText(fetch.stdout.trim()) : null,
          pushUrl: push.exitCode === 0 ? redactSensitiveText(push.stdout.trim()) : null,
        } satisfies Remote;
      }),
    );
  }

  private async getRemoteBranches(repositoryPath: string): Promise<RemoteBranch[]> {
    const result = await this.executeChecked(repositoryPath, [
      'for-each-ref',
      `--format=%(refname:short)%00%(objectname)%00${RECORD_SEPARATOR}`,
      'refs/remotes',
    ]);
    return result.stdout
      .split(RECORD_SEPARATOR)
      .map((record) => record.trimEnd())
      .filter(Boolean)
      .map((record) => {
        const [name, objectId] = record.split('\0');
        const separator = name?.indexOf('/') ?? -1;
        const remote = separator > 0 ? (name?.slice(0, separator) ?? '') : '';
        const branch = separator > 0 ? (name?.slice(separator + 1) ?? '') : (name ?? '');
        return {
          name: name ?? '',
          remote,
          branch,
          objectId: objectId ?? '',
        } satisfies RemoteBranch;
      })
      .filter((branch) => branch.branch !== 'HEAD');
  }

  private async getTags(repositoryPath: string): Promise<Tag[]> {
    const result = await this.executeChecked(repositoryPath, [
      'for-each-ref',
      `--format=%(refname:short)%00%(objectname)%00%(creatordate:iso-strict)%00${RECORD_SEPARATOR}`,
      'refs/tags',
    ]);
    return result.stdout
      .split(RECORD_SEPARATOR)
      .map((record) => record.trimEnd())
      .filter(Boolean)
      .map((record) => {
        const [name, objectId, createdAt] = record.split('\0');
        return {
          name: name ?? '',
          objectId: objectId ?? '',
          createdAt: createdAt || null,
        } satisfies Tag;
      });
  }

  private async getSubmodules(repositoryPath: string): Promise<Submodule[]> {
    const result = await this.execute(repositoryPath, [
      'config',
      '--null',
      '--get-regexp',
      '^submodule\\..*\\.(path|url)$',
    ]);
    if (result.exitCode !== 0) {
      return [];
    }
    const values = result.stdout.split('\0').filter(Boolean);
    const modules = new Map<string, { path?: string; url?: string }>();
    for (let index = 0; index + 1 < values.length; index += 2) {
      const key = values[index] ?? '';
      const value = values[index + 1] ?? '';
      const match = key.match(/^submodule\.(.+)\.(path|url)$/);
      if (match === null) continue;
      const name = match[1] ?? '';
      const current = modules.get(name) ?? {};
      if (match[2] === 'path') current.path = value;
      else current.url = redactSensitiveText(value);
      modules.set(name, current);
    }
    return [...modules.entries()]
      .filter(([, module]) => module.path !== undefined)
      .map(
        ([name, module]) =>
          ({ name, path: module.path ?? '', url: module.url ?? null }) satisfies Submodule,
      );
  }

  private async getWorktrees(repositoryPath: string): Promise<Worktree[]> {
    const result = await this.executeChecked(repositoryPath, ['worktree', 'list', '--porcelain']);
    const worktrees: Worktree[] = [];
    let current: Partial<Worktree> | null = null;
    const pushCurrent = (): void => {
      if (current?.path === undefined) return;
      worktrees.push({
        path: current.path,
        head: current.head ?? null,
        branch: current.branch ?? null,
        bare: current.bare ?? false,
        detached: current.detached ?? false,
      });
      current = null;
    };
    for (const line of result.stdout.split('\n')) {
      if (line === '') {
        pushCurrent();
        continue;
      }
      if (line.startsWith('worktree ')) current = { path: line.slice(9) };
      else if (line.startsWith('HEAD ')) current = { ...(current ?? {}), head: line.slice(5) };
      else if (line.startsWith('branch '))
        current = { ...(current ?? {}), branch: line.slice(7).replace(/^refs\/heads\//, '') };
      else if (line === 'bare') current = { ...(current ?? {}), bare: true };
      else if (line === 'detached') current = { ...(current ?? {}), detached: true };
    }
    pushCurrent();
    return worktrees;
  }

  public async getChangedFiles(
    repositoryPath: string,
    kind: 'working' | 'staged' | 'commit' | 'compare',
    ref?: string,
    baseRef?: string,
  ): Promise<ChangedFile[]> {
    const args = ['diff', '--name-status', '-z', '--find-renames'];
    if (kind === 'staged') args.push('--cached');
    else if (kind === 'commit') args.push(`${ref ?? 'HEAD'}^`, ref ?? 'HEAD');
    else if (kind === 'compare') args.push(`${baseRef ?? 'HEAD'}...${ref ?? 'HEAD'}`);
    args.push('--');
    const result = await this.executeChecked(repositoryPath, args);
    return parseNameStatus(result.stdout);
  }

  public async readDiff(
    repositoryPath: string,
    kind: 'working' | 'staged' | 'commit' | 'compare',
    filePath: string,
    ref?: string,
    baseRef?: string,
    maxBytes = 2 * 1024 * 1024,
  ): Promise<{ content: string; binary: boolean; truncated: boolean; bytes: number }> {
    const safePath = validateRelativePath(filePath);
    const args = ['diff', '--no-ext-diff', '--unified=3'];
    if (kind === 'staged') args.push('--cached');
    else if (kind === 'commit') args.push(`${ref ?? 'HEAD'}^`, ref ?? 'HEAD');
    else if (kind === 'compare') args.push(`${baseRef ?? 'HEAD'}...${ref ?? 'HEAD'}`);
    args.push('--', safePath);
    const result = await this.execute(repositoryPath, args);
    if (result.exitCode !== 0 && result.exitCode !== 1) throw this.mapCommandFailure(result);
    const content = result.stdout;
    const bytes = Buffer.byteLength(content, 'utf8');
    const binary = content.includes('Binary files') || content.includes('GIT binary patch');
    return {
      content: bytes > maxBytes ? content.slice(0, maxBytes) : content,
      binary,
      truncated: bytes > maxBytes,
      bytes,
    };
  }

  public async stage(repositoryPath: string, paths: readonly string[]): Promise<void> {
    const safePaths = paths.map((filePath) => validateRelativePath(filePath));
    await this.executeChecked(repositoryPath, ['add', '--', ...safePaths]);
  }

  public async unstage(repositoryPath: string, paths: readonly string[]): Promise<void> {
    const safePaths = paths.map((filePath) => validateRelativePath(filePath));
    await this.executeChecked(repositoryPath, ['restore', '--staged', '--', ...safePaths]);
  }

  public async getCommit(repositoryPath: string, commitish: string): Promise<GitCommitRecord> {
    validateGitName(commitish, 'ref');
    const result = await this.executeChecked(repositoryPath, [
      'show',
      '-s',
      '--format=%H%x00%P%x00%an%x00%ae%x00%aI%x00%s%x00%b%x00%D',
      commitish,
      '--',
    ]);
    const [hash, parents, authorName, authorEmail, authoredAt, subject, body, decorations] =
      result.stdout.split('\0');
    return {
      hash: hash ?? '',
      parents: parents?.split(' ').filter(Boolean) ?? [],
      authorName: authorName ?? '',
      authorEmail: authorEmail ?? '',
      authoredAt: authoredAt ?? '',
      subject: subject ?? '',
      body: body ?? '',
      decorations: decorations?.split(', ').filter(Boolean) ?? [],
    };
  }
}

const pathExists = async (candidate: string): Promise<boolean> => {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
};

const parseNameStatus = (output: string): ChangedFile[] => {
  const tokens = output.split('\0').filter(Boolean);
  const files: ChangedFile[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const statusToken = tokens[index] ?? '';
    const pathValue = tokens[index + 1] ?? '';
    index += 1;
    const statusCode = statusToken[0] ?? '?';
    let status: ChangedFile['status'] = 'unknown';
    if (statusCode === 'A') status = 'added';
    else if (statusCode === 'M') status = 'modified';
    else if (statusCode === 'D') status = 'deleted';
    else if (statusCode === 'R') status = 'renamed';
    else if (statusCode === 'C') status = 'copied';
    else if (statusCode === 'U') status = 'unmerged';
    const oldPath = status === 'renamed' || status === 'copied' ? tokens[index + 1] : undefined;
    if (oldPath !== undefined) index += 1;
    files.push({
      path: pathValue,
      status,
      ...(oldPath === undefined ? {} : { oldPath }),
      additions: null,
      deletions: null,
      binary: false,
    });
  }
  return files;
};
