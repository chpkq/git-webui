import { createHash } from 'node:crypto';
import { access, lstat, open, readlink, realpath } from 'node:fs/promises';
import path from 'node:path';
import {
  GitWebUiError,
  type Branch,
  type ChangedFile,
  type CommitDetail,
  type CommitPage,
  type CommitSummary,
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
  validateCommitish,
  validateGitName,
  validateRelativePath,
  validateRepositoryPath,
  validateGitUrl,
  type ValidatedRepository,
} from './path-security.js';

const RECORD_SEPARATOR = '\u001e';
const MAX_FINGERPRINT_SAMPLE_BYTES = 1024 * 1024;

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

interface CommitStats {
  additions: number | null;
  deletions: number | null;
  changedFiles: number | null;
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

  private async execute(
    repositoryPath: string,
    args: readonly string[],
    onOutput?: (stream: 'stdout' | 'stderr', chunk: string) => void,
    signal?: AbortSignal,
    options?: { maxOutputBytes?: number; allowTruncated?: boolean },
  ): Promise<CommandResult> {
    const validated = await this.validateRepository(repositoryPath);
    return await this.runner.run({
      cwd: validated.path,
      args,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GCM_INTERACTIVE: 'Never',
        GIT_OPTIONAL_LOCKS: '0',
      },
      onOutput,
      signal,
      ...options,
    });
  }

  private async executeChecked(
    repositoryPath: string,
    args: readonly string[],
    onOutput?: (stream: 'stdout' | 'stderr', chunk: string) => void,
    signal?: AbortSignal,
  ): Promise<CommandResult> {
    const result = await this.execute(repositoryPath, args, onOutput, signal);
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
    if (
      lower.includes('non-fast-forward') ||
      lower.includes('fetch first') ||
      lower.includes('not possible to fast-forward')
    ) {
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

  public async getStateFingerprints(
    repositoryPath: string,
    paths: readonly string[] = [],
  ): Promise<{ workingTreeFingerprint: string; indexFingerprint: string }> {
    const safePaths = paths.map((filePath) => validateRelativePath(filePath));
    const statusPaths =
      safePaths.length > 0
        ? []
        : (await this.getParsedStatus(repositoryPath)).entries.flatMap((entry) =>
            'renameFrom' in entry && entry.renameFrom !== undefined
              ? [entry.path, entry.renameFrom]
              : [entry.path],
          );
    const fingerprintPaths = [...new Set([...safePaths, ...statusPaths])].sort();
    const pathArgs = ['--', ...safePaths];
    const [workingTree, index] = await Promise.all([
      this.executeChecked(repositoryPath, [
        'diff-files',
        '--raw',
        '--no-renames',
        '-z',
        ...pathArgs,
      ]),
      this.executeChecked(repositoryPath, [
        'diff',
        '--cached',
        '--raw',
        '--no-renames',
        '-z',
        ...pathArgs,
      ]),
    ]);
    const validated =
      fingerprintPaths.length > 0 ? await this.validateRepository(repositoryPath) : null;
    const workingTreeHash = createHash('sha256').update(workingTree.stdout);
    if (validated !== null) {
      for (const filePath of fingerprintPaths) {
        const candidate = path.resolve(validated.path, filePath);
        workingTreeHash.update(`\0${filePath}`);
        try {
          const info = await lstat(candidate);
          if (info.isSymbolicLink()) {
            workingTreeHash.update(`symlink:${await readlink(candidate)}`);
          } else if (info.isFile()) {
            workingTreeHash.update(`${info.size}:${info.mtimeMs}:${info.ctimeMs}:${info.mode}`);
            const handle = await open(candidate, 'r');
            try {
              const sample = Buffer.alloc(Math.min(info.size, MAX_FINGERPRINT_SAMPLE_BYTES));
              const read = await handle.read(sample, 0, sample.byteLength, 0);
              workingTreeHash.update(sample.subarray(0, read.bytesRead));
            } finally {
              await handle.close();
            }
          } else {
            workingTreeHash.update(`other:${info.mode}`);
          }
        } catch {
          workingTreeHash.update('missing');
        }
      }
    }
    return {
      workingTreeFingerprint: workingTreeHash.digest('hex'),
      indexFingerprint: createHash('sha256').update(index.stdout).digest('hex'),
    };
  }

  public async fetchAllPrune(
    repositoryPath: string,
    onProgress?: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.executeChecked(
      repositoryPath,
      ['fetch', '--all', '--prune', '--progress'],
      (_stream, chunk) => {
        onProgress?.(redactSensitiveText(chunk.trim()));
      },
      signal,
    );
  }

  public async pullFastForwardOnly(
    repositoryPath: string,
    onProgress?: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.executeChecked(
      repositoryPath,
      ['pull', '--ff-only', '--progress'],
      (_stream, chunk) => {
        onProgress?.(redactSensitiveText(chunk.trim()));
      },
      signal,
    );
  }

  public async pushExplicit(
    repositoryPath: string,
    remote: string,
    branch: string,
    setUpstream: boolean,
    onProgress?: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    validateGitName(remote, 'remote');
    validateGitName(branch, 'branch');
    const configuredRemotes = (await this.executeChecked(repositoryPath, ['remote'])).stdout
      .split('\n')
      .map((name) => name.trim())
      .filter(Boolean);
    if (!configuredRemotes.includes(remote)) {
      throw new GitWebUiError('INVALID_REMOTE', 'Push 目标 Remote 未在当前仓库配置。', { remote });
    }
    const localBranch = `refs/heads/${branch}`;
    const branchResult = await this.execute(repositoryPath, [
      'show-ref',
      '--verify',
      '--quiet',
      localBranch,
    ]);
    if (branchResult.exitCode !== 0) {
      throw new GitWebUiError('INVALID_BRANCH', 'Push 目标本地 Branch 不存在。', { branch });
    }
    const args = ['push', '--progress'];
    if (setUpstream) args.push('--set-upstream');
    args.push(remote, `${localBranch}:${localBranch}`);
    await this.executeChecked(
      repositoryPath,
      args,
      (_stream, chunk) => {
        onProgress?.(redactSensitiveText(chunk.trim()));
      },
      signal,
    );
  }

  public async addRemote(
    repositoryPath: string,
    name: string,
    fetchUrl: string,
    pushUrl?: string,
  ): Promise<void> {
    validateGitName(name, 'remote');
    validateGitUrl(fetchUrl);
    if (pushUrl !== undefined) validateGitUrl(pushUrl);
    await this.executeChecked(repositoryPath, ['remote', 'add', name, fetchUrl]);
    if (pushUrl !== undefined && pushUrl !== fetchUrl) {
      try {
        await this.executeChecked(repositoryPath, ['remote', 'set-url', '--push', name, pushUrl]);
      } catch (error) {
        try {
          await this.execute(repositoryPath, ['remote', 'remove', name]);
        } catch {
          // 回滚失败时仍保留原始 Push URL 错误，避免掩盖真正原因。
        }
        throw error;
      }
    }
  }

  public async setRemoteUrl(
    repositoryPath: string,
    name: string,
    url: string,
    push: boolean,
  ): Promise<void> {
    validateGitName(name, 'remote');
    validateGitUrl(url);
    const args = ['remote', 'set-url'];
    if (push) args.push('--push');
    args.push(name, url);
    await this.executeChecked(repositoryPath, args);
  }

  public async removeRemote(repositoryPath: string, name: string): Promise<void> {
    validateGitName(name, 'remote');
    await this.executeChecked(repositoryPath, ['remote', 'remove', name]);
  }

  public async createBranch(
    repositoryPath: string,
    name: string,
    startPoint?: string,
  ): Promise<void> {
    validateGitName(name, 'branch');
    const args = ['branch', name];
    if (startPoint !== undefined) args.push(validateCommitish(startPoint));
    await this.executeChecked(repositoryPath, args);
  }

  public async switchBranch(repositoryPath: string, name: string): Promise<void> {
    validateGitName(name, 'branch');
    const status = await this.getStatus(repositoryPath);
    if (status.inProgress.length > 0) {
      throw new GitWebUiError('GIT_IN_PROGRESS', '仓库存在进行中的 Git 状态，不能切换分支。');
    }
    if (status.dirty) throw new GitWebUiError('DIRTY_WORKTREE', '工作区不干净，不能切换分支。');
    await this.executeChecked(repositoryPath, ['switch', name]);
  }

  public async renameBranch(
    repositoryPath: string,
    oldName: string,
    newName: string,
  ): Promise<void> {
    validateGitName(oldName, 'branch');
    validateGitName(newName, 'branch');
    await this.executeChecked(repositoryPath, ['branch', '-m', oldName, newName]);
  }

  public async deleteBranchSafe(repositoryPath: string, name: string): Promise<void> {
    validateGitName(name, 'branch');
    const status = await this.getStatus(repositoryPath);
    if (status.branch === name) throw new GitWebUiError('INVALID_BRANCH', '不能删除当前分支。');
    const locations = await this.getLocations(repositoryPath);
    const branch = locations.branches.find((item) => item.name === name);
    const occupiedByWorktree =
      (branch?.worktreePath !== null && branch?.worktreePath !== undefined) ||
      locations.worktrees.some((worktree) => worktree.branch === name);
    if (occupiedByWorktree) {
      throw new GitWebUiError('INVALID_BRANCH', '不能删除被其他 Worktree 占用的分支。');
    }
    await this.executeChecked(repositoryPath, ['branch', '-d', '--', name]);
  }

  public async setUpstream(
    repositoryPath: string,
    localBranch: string,
    remote: string,
    remoteBranch: string,
  ): Promise<void> {
    validateGitName(localBranch, 'branch');
    validateGitName(remote, 'remote');
    validateGitName(remoteBranch, 'branch');
    await this.executeChecked(repositoryPath, [
      'branch',
      `--set-upstream-to=${remote}/${remoteBranch}`,
      localBranch,
    ]);
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
      .map((record) => record.replace(/^\n/, '').trimEnd())
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
      '--file',
      '.gitmodules',
      '--null',
      '--get-regexp',
      '^submodule\\..*\\.(path|url)$',
    ]);
    if (result.exitCode !== 0) {
      return [];
    }
    const records = result.stdout.split('\0').filter(Boolean);
    const modules = new Map<string, { path?: string; url?: string }>();
    for (const record of records) {
      const separator = record.indexOf('\n');
      if (separator < 0) continue;
      const key = record.slice(0, separator);
      const value = record.slice(separator + 1);
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
    parentRef?: string,
  ): Promise<ChangedFile[]> {
    const safeRef = ref === undefined ? 'HEAD' : validateCommitish(ref);
    const safeBaseRef = baseRef === undefined ? 'HEAD' : validateCommitish(baseRef);
    const safeParentRef = parentRef === undefined ? undefined : validateCommitish(parentRef);
    const args =
      kind === 'commit' && safeParentRef !== undefined
        ? ['diff', '--name-status', '-z', '--find-renames', safeParentRef, safeRef]
        : kind === 'commit'
          ? [
              'diff-tree',
              '--root',
              '--no-commit-id',
              '--name-status',
              '-z',
              '-r',
              '--find-renames',
              safeRef,
            ]
          : ['diff', '--name-status', '-z', '--find-renames'];
    if (kind === 'staged') args.push('--cached');
    else if (kind === 'compare') args.push(`${safeBaseRef}...${safeRef}`);
    args.push('--');
    const result = await this.executeChecked(repositoryPath, args);
    return parseNameStatus(result.stdout);
  }

  public async getCommitPage(
    repositoryPath: string,
    ref: string,
    offset: number,
    limit: number,
  ): Promise<CommitPage> {
    const safeRef = validateCommitish(ref);
    const status = await this.getParsedStatus(repositoryPath);
    if (safeRef === 'HEAD' && status.head === null) {
      return { items: [], nextCursor: null, hasMore: false };
    }
    const result = await this.executeChecked(repositoryPath, [
      'log',
      '--topo-order',
      '--date-order',
      `--max-count=${limit + 1}`,
      `--skip=${offset}`,
      '--format=%H%x00%P%x00%an%x00%ae%x00%aI%x00%s%x00%b%x00%D%x1e',
      safeRef,
      '--',
    ]);
    const records = parseCommitRecords(result.stdout);
    const hasMore = records.length > limit;
    const pageRecords = records.slice(0, limit);
    const items = await mapWithConcurrency(pageRecords, 8, async (record) =>
      toCommitSummary(
        record,
        await this.getCommitStats(repositoryPath, record.hash, record.parents[0]),
      ),
    );
    return {
      items,
      nextCursor: hasMore ? String(offset + limit) : null,
      hasMore,
    };
  }

  public async getCommitDetail(repositoryPath: string, commitish: string): Promise<CommitDetail> {
    const commit = await this.getCommit(repositoryPath, commitish);
    const [changedFiles, stats] = await Promise.all([
      this.getChangedFiles(repositoryPath, 'commit', commit.hash, undefined, commit.parents[0]),
      this.getCommitFileStats(repositoryPath, commit.hash, commit.parents[0]),
    ]);
    const files = changedFiles.map((file) => {
      const fileStats = stats.get(file.path);
      return {
        ...file,
        additions: fileStats?.additions ?? null,
        deletions: fileStats?.deletions ?? null,
        binary: fileStats?.binary ?? file.binary,
      };
    });
    return {
      commit: toCommitSummary(commit, {
        additions: files.reduce((sum, file) => sum + (file.additions ?? 0), 0),
        deletions: files.reduce((sum, file) => sum + (file.deletions ?? 0), 0),
        changedFiles: files.length,
      }),
      body: commit.body,
      changedFiles: files,
    };
  }

  private async getCommitStats(
    repositoryPath: string,
    commitish: string,
    parentRef?: string,
  ): Promise<CommitStats> {
    const stats = await this.getCommitFileStats(repositoryPath, commitish, parentRef);
    let additions = 0;
    let deletions = 0;
    let hasBinary = false;
    for (const value of stats.values()) {
      if (value.additions === null || value.deletions === null) {
        hasBinary = true;
      } else {
        additions += value.additions;
        deletions += value.deletions;
      }
    }
    return {
      additions: hasBinary ? null : additions,
      deletions: hasBinary ? null : deletions,
      changedFiles: stats.size,
    };
  }

  private async getCommitFileStats(
    repositoryPath: string,
    commitish: string,
    parentRef?: string,
  ): Promise<Map<string, { additions: number | null; deletions: number | null; binary: boolean }>> {
    const safeCommitish = validateCommitish(commitish);
    const safeParentRef = parentRef === undefined ? undefined : validateCommitish(parentRef);
    const result = await this.executeChecked(
      repositoryPath,
      safeParentRef === undefined
        ? [
            'diff-tree',
            '--root',
            '--no-commit-id',
            '--numstat',
            '-z',
            '-r',
            '--find-renames',
            safeCommitish,
            '--',
          ]
        : ['diff', '--numstat', '-z', '--find-renames', safeParentRef, safeCommitish, '--'],
    );
    const stats = new Map<
      string,
      { additions: number | null; deletions: number | null; binary: boolean }
    >();
    const records = result.stdout.split('\0');
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index] ?? '';
      if (record === '') continue;
      const fields = record.split('\t');
      if (fields.length < 3) continue;
      let pathValue = fields.slice(2).join('\t');
      if (pathValue === '' && index + 2 < records.length) {
        index += 1;
        pathValue = records[index + 1] ?? '';
        index += 1;
      }
      const binary = fields[0] === '-' || fields[1] === '-';
      stats.set(pathValue, {
        additions: binary ? null : Number(fields[0]),
        deletions: binary ? null : Number(fields[1]),
        binary,
      });
    }
    return stats;
  }

  public async readDiff(
    repositoryPath: string,
    kind: 'working' | 'staged' | 'commit' | 'compare',
    filePath: string,
    ref?: string,
    baseRef?: string,
    maxBytes = 2 * 1024 * 1024,
  ): Promise<{
    content: string;
    originalContent: string;
    modifiedContent: string;
    binary: boolean;
    truncated: boolean;
    bytes: number;
  }> {
    const safePath = validateRelativePath(filePath);
    const safeRef = ref === undefined ? 'HEAD' : validateCommitish(ref);
    const safeBaseRef = baseRef === undefined ? 'HEAD' : validateCommitish(baseRef);
    let args: string[];
    let commit: GitCommitRecord | undefined;
    if (kind === 'commit') {
      commit = await this.getCommit(repositoryPath, safeRef);
      args =
        commit.parents[0] === undefined
          ? [
              'diff-tree',
              '--root',
              '--no-commit-id',
              '--patch',
              '--find-renames',
              '--unified=3',
              commit.hash,
            ]
          : [
              'diff',
              '--no-ext-diff',
              '--patch',
              '--find-renames',
              '--unified=3',
              commit.parents[0],
              commit.hash,
            ];
    } else {
      args = ['diff', '--no-ext-diff', '--unified=3'];
    }
    if (kind === 'staged') args.push('--cached');
    else if (kind === 'compare') args.push(`${safeBaseRef}...${safeRef}`);
    args.push('--', safePath);
    const safeMaxBytes = Math.min(Math.max(1, maxBytes), 10 * 1024 * 1024);
    let result = await this.execute(repositoryPath, args, undefined, undefined, {
      maxOutputBytes: safeMaxBytes,
      allowTruncated: true,
    });
    if (!result.truncated && result.exitCode !== 0 && result.exitCode !== 1) {
      throw this.mapCommandFailure(result);
    }
    if (kind === 'working' && result.stdout === '') {
      const status = await this.getStatus(repositoryPath);
      const isUntracked = status.entries.some(
        (entry) => entry.kind === 'untracked' && entry.path === safePath,
      );
      if (isUntracked && (await this.isSafeUntrackedFile(repositoryPath, safePath))) {
        result = await this.execute(
          repositoryPath,
          ['diff', '--no-index', '--no-ext-diff', '--unified=3', '--', '/dev/null', safePath],
          undefined,
          undefined,
          { maxOutputBytes: safeMaxBytes, allowTruncated: true },
        );
        if (!result.truncated && result.exitCode !== 0 && result.exitCode !== 1) {
          throw this.mapCommandFailure(result);
        }
      }
    }
    const content = result.stdout;
    const fileContents =
      result.truncated || content === ''
        ? { original: '', modified: '', bytes: 0, truncated: false, binary: false }
        : await this.getDiffFileContents(
            repositoryPath,
            kind,
            safePath,
            safeRef,
            safeBaseRef,
            commit,
            safeMaxBytes,
          );
    const bytes = Math.max(result.stdoutBytes, fileContents.bytes);
    const binary =
      content.includes('Binary files') ||
      content.includes('GIT binary patch') ||
      fileContents.binary;
    return {
      content: sliceUtf8ByBytes(content, safeMaxBytes),
      originalContent: fileContents.original,
      modifiedContent: fileContents.modified,
      binary,
      truncated: result.truncated || fileContents.truncated || bytes > safeMaxBytes,
      bytes,
    };
  }

  private async getDiffFileContents(
    repositoryPath: string,
    kind: 'working' | 'staged' | 'commit' | 'compare',
    filePath: string,
    ref: string,
    baseRef: string,
    commit: GitCommitRecord | undefined,
    maxBytes: number,
  ): Promise<{
    original: string;
    modified: string;
    bytes: number;
    truncated: boolean;
    binary: boolean;
  }> {
    let originalSpec: string | null;
    let modifiedSpec: string | null;
    let readWorkingTree = false;
    switch (kind) {
      case 'working':
        originalSpec = `:${filePath}`;
        modifiedSpec = null;
        readWorkingTree = true;
        break;
      case 'staged':
        originalSpec = `${ref}:${filePath}`;
        modifiedSpec = `:${filePath}`;
        break;
      case 'commit':
        originalSpec = commit?.parents[0] === undefined ? null : `${commit.parents[0]}:${filePath}`;
        modifiedSpec = commit === undefined ? null : `${commit.hash}:${filePath}`;
        break;
      case 'compare':
        originalSpec = `${baseRef}:${filePath}`;
        modifiedSpec = `${ref}:${filePath}`;
        break;
    }
    const original =
      originalSpec === null ? null : await this.readGitBlob(repositoryPath, originalSpec, maxBytes);
    const modified = readWorkingTree
      ? await this.readWorkingTreeFile(repositoryPath, filePath, maxBytes)
      : modifiedSpec === null
        ? null
        : await this.readGitBlob(repositoryPath, modifiedSpec, maxBytes);
    const values = [original, modified].filter(
      (value): value is { content: string; bytes: number; truncated: boolean } => value !== null,
    );
    return {
      original: original?.content ?? '',
      modified: modified?.content ?? '',
      bytes: values.reduce((sum, value) => Math.max(sum, value.bytes), 0),
      truncated: values.some((value) => value.truncated),
      binary: values.some((value) => value.content.includes('\0')),
    };
  }

  private async readGitBlob(
    repositoryPath: string,
    spec: string,
    maxBytes: number,
  ): Promise<{ content: string; bytes: number; truncated: boolean } | null> {
    const result = await this.execute(
      repositoryPath,
      ['cat-file', 'blob', spec],
      undefined,
      undefined,
      {
        maxOutputBytes: maxBytes,
        allowTruncated: true,
      },
    );
    if (result.exitCode !== 0 && !result.truncated) return null;
    return {
      content: result.stdout,
      bytes: result.stdoutBytes,
      truncated: result.truncated,
    };
  }

  private async readWorkingTreeFile(
    repositoryPath: string,
    filePath: string,
    maxBytes: number,
  ): Promise<{ content: string; bytes: number; truncated: boolean } | null> {
    const repository = await this.validateRepository(repositoryPath);
    const candidate = path.resolve(repository.path, filePath);
    try {
      const info = await lstat(candidate);
      if (info.isSymbolicLink()) {
        const content = await readlink(candidate);
        return { content, bytes: Buffer.byteLength(content), truncated: false };
      }
      if (!info.isFile()) return null;
      const resolved = await realpath(candidate);
      const relative = path.relative(repository.path, resolved);
      if (
        relative !== '' &&
        (relative.startsWith('..') ||
          path.isAbsolute(relative) ||
          relative.split(path.sep).includes('.git'))
      ) {
        return null;
      }
      const handle = await open(candidate, 'r');
      try {
        const buffer = Buffer.alloc(Math.min(info.size, maxBytes + 1));
        const read = await handle.read(buffer, 0, buffer.byteLength, 0);
        const truncated = read.bytesRead > maxBytes || info.size > maxBytes;
        return {
          content: buffer.subarray(0, Math.min(read.bytesRead, maxBytes)).toString('utf8'),
          bytes: info.size,
          truncated,
        };
      } finally {
        await handle.close();
      }
    } catch {
      return null;
    }
  }

  public async stage(repositoryPath: string, paths: readonly string[]): Promise<void> {
    const safePaths = paths.map((filePath) => validateRelativePath(filePath));
    await this.executeChecked(repositoryPath, ['add', '--', ...safePaths]);
  }

  private async isSafeUntrackedFile(repositoryPath: string, filePath: string): Promise<boolean> {
    const repository = await this.validateRepository(repositoryPath);
    const candidate = path.resolve(repository.path, filePath);
    try {
      const info = await lstat(candidate);
      if (!info.isFile()) return false;
      const resolved = await realpath(candidate);
      const relative = path.relative(repository.path, resolved);
      return (
        (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) &&
        !relative.split(path.sep).includes('.git')
      );
    } catch {
      return false;
    }
  }

  public async unstage(repositoryPath: string, paths: readonly string[]): Promise<void> {
    const safePaths = paths.map((filePath) => validateRelativePath(filePath));
    const status = await this.getParsedStatus(repositoryPath);
    if (status.head === null) {
      await this.executeChecked(repositoryPath, [
        'update-index',
        '--force-remove',
        '--',
        ...safePaths,
      ]);
      return;
    }
    await this.executeChecked(repositoryPath, ['restore', '--staged', '--', ...safePaths]);
  }

  public async getCommit(repositoryPath: string, commitish: string): Promise<GitCommitRecord> {
    validateCommitish(commitish);
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

const sliceUtf8ByBytes = (value: string, maxBytes: number): string => {
  const buffer = Buffer.from(value, 'utf8');
  return buffer.byteLength > maxBytes ? buffer.subarray(0, maxBytes).toString('utf8') : value;
};

const mapWithConcurrency = async <T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> => {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= values.length) return;
      results[index] = await mapper(values[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, worker));
  return results;
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
    const oldPath = status === 'renamed' || status === 'copied' ? pathValue : undefined;
    const newPath = oldPath === undefined ? pathValue : (tokens[index + 1] ?? '');
    if (oldPath !== undefined) index += 1;
    files.push({
      path: newPath,
      status,
      ...(oldPath === undefined ? {} : { oldPath }),
      additions: null,
      deletions: null,
      binary: false,
    });
  }
  return files;
};

const parseCommitRecords = (output: string): GitCommitRecord[] =>
  output
    .split(RECORD_SEPARATOR)
    .map((record) => record.replace(/^\n/, ''))
    .filter(Boolean)
    .map((record) => {
      const [hash, parents, authorName, authorEmail, authoredAt, subject, body, decorations] =
        record.split('\0');
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
    });

const toCommitSummary = (record: GitCommitRecord, stats: CommitStats): CommitSummary => ({
  hash: record.hash,
  parents: record.parents,
  authorName: record.authorName,
  authorEmail: record.authorEmail,
  authoredAt: record.authoredAt,
  subject: record.subject,
  decorations: record.decorations,
  additions: stats.additions,
  deletions: stats.deletions,
  changedFiles: stats.changedFiles,
});
