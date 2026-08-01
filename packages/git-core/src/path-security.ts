import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { GitWebUiError } from '@git-webui/shared';
import type { CommandRunner } from './command-runner.js';

export interface ValidatedRepository {
  path: string;
  gitDir: string;
}

const isWithin = (root: string, candidate: string): boolean => {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const hasControlCharacters = (value: string): boolean =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint < 0x20 || codePoint === 0x7f;
  });

const realpathOrSkip = async (candidate: string): Promise<string | null> => {
  try {
    return await realpath(candidate);
  } catch {
    return null;
  }
};

export const validateRelativePath = (value: string): string => {
  if (
    value.length === 0 ||
    value.includes('\0') ||
    path.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    value.split(/[\\/]/u).some((segment) => segment === '..')
  ) {
    throw new GitWebUiError('INVALID_PATH', '文件路径必须是仓库内的相对路径。');
  }
  return value;
};

export const validateGitName = (value: string, kind: 'ref' | 'remote' | 'branch'): string => {
  if (
    value.length === 0 ||
    value.startsWith('-') ||
    value.includes('\0') ||
    hasControlCharacters(value) ||
    value.includes('..') ||
    value.includes('@{') ||
    value.includes('\\') ||
    value.includes('//') ||
    value.endsWith('/') ||
    value.endsWith('.') ||
    value
      .split('/')
      .some((segment) => segment === '' || segment === '.' || segment.endsWith('.lock'))
  ) {
    throw new GitWebUiError(
      `INVALID_${kind.toUpperCase()}` as 'INVALID_REF',
      `非法的 ${kind} 名称。`,
      {
        value,
      },
    );
  }
  return value;
};

export const validateCommitish = (value: string): string => {
  if (
    value.length === 0 ||
    value.startsWith('-') ||
    value.includes('\0') ||
    hasControlCharacters(value) ||
    /\s/u.test(value)
  ) {
    throw new GitWebUiError('INVALID_REF', '非法的 commitish。', { value });
  }
  return value;
};

export const validateRepositoryPath = async (
  candidate: string,
  allowedRoots: readonly string[],
  runner: CommandRunner,
): Promise<ValidatedRepository> => {
  const resolvedCandidate = await realpathOrSkip(candidate);
  if (resolvedCandidate === null) {
    throw new GitWebUiError('REPOSITORY_NOT_FOUND', '仓库路径不存在或无法访问。');
  }
  const info = await stat(resolvedCandidate);
  if (!info.isDirectory()) {
    throw new GitWebUiError('REPOSITORY_NOT_FOUND', '仓库路径不是目录。');
  }
  const resolvedRoots = (await Promise.all(allowedRoots.map(realpathOrSkip))).filter(
    (root): root is string => root !== null,
  );
  if (!resolvedRoots.some((root) => isWithin(root, resolvedCandidate))) {
    throw new GitWebUiError('REPOSITORY_NOT_ALLOWED', '仓库路径不在 allowedRoots 范围内。');
  }
  const result = await runner.run({
    cwd: resolvedCandidate,
    args: ['rev-parse', '--show-toplevel'],
  });
  if (result.exitCode !== 0) {
    throw new GitWebUiError('REPOSITORY_NOT_GIT', '指定目录不是可用的 Git 仓库。');
  }
  const gitRoot = await realpathOrSkip(result.stdout.trim());
  if (gitRoot === null || !resolvedRoots.some((root) => isWithin(root, gitRoot))) {
    throw new GitWebUiError('REPOSITORY_NOT_ALLOWED', 'Git 仓库根目录不在 allowedRoots 范围内。');
  }
  return { path: gitRoot, gitDir: gitRoot };
};
