import type { FileStatus, RepositoryStatus } from '@git-webui/shared';

export interface ParsedPorcelainStatus {
  head: string | null;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  entries: FileStatus[];
}

const parseAheadBehind = (value: string | undefined): { ahead: number; behind: number } => {
  if (value === undefined || value === '') {
    return { ahead: 0, behind: 0 };
  }
  const match = value.match(/^([+-]\d+)\s+([+-]\d+)$/);
  if (match === null) {
    return { ahead: 0, behind: 0 };
  }
  return {
    ahead: Math.max(0, Number(match[1]?.slice(1) ?? 0)),
    behind: Math.max(0, Number(match[2]?.slice(1) ?? 0)),
  };
};

const parseHeader = (line: string, state: ParsedPorcelainStatus): void => {
  const content = line.slice(2);
  const separator = content.indexOf(' ');
  if (separator < 0) {
    return;
  }
  const key = content.slice(0, separator);
  const value = content.slice(separator + 1);
  switch (key) {
    case 'branch.oid':
      state.head = value === '(initial)' ? null : value;
      break;
    case 'branch.head':
      state.branch = value === '(detached)' ? null : value;
      break;
    case 'branch.upstream':
      state.upstream = value;
      break;
    case 'branch.ab': {
      const aheadBehind = parseAheadBehind(value);
      state.ahead = aheadBehind.ahead;
      state.behind = aheadBehind.behind;
      break;
    }
    default:
      break;
  }
};

const getFileStatus = (
  kind: FileStatus['kind'],
  indexStatus: string,
  worktreeStatus: string,
  path: string,
  renameFrom?: string,
): FileStatus => ({
  path,
  kind,
  indexStatus,
  worktreeStatus,
  staged: indexStatus !== '.' && indexStatus !== '?',
  unstaged: worktreeStatus !== '.' && worktreeStatus !== '?',
  ...(renameFrom === undefined ? {} : { renameFrom }),
});

const splitMetadataAndPath = (
  record: string,
  metadataFieldCount: number,
): { metadata: string[]; path: string } => {
  let pathStart = 0;
  for (let index = 0; index < metadataFieldCount; index += 1) {
    const separator = record.indexOf(' ', pathStart);
    if (separator < 0) {
      return { metadata: record.split(' '), path: '' };
    }
    pathStart = separator + 1;
  }
  const metadataText = record.slice(0, pathStart - 1);
  return { metadata: metadataText.split(' '), path: record.slice(pathStart) };
};

export const parsePorcelainV2 = (output: string): ParsedPorcelainStatus => {
  const state: ParsedPorcelainStatus = {
    head: null,
    branch: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    entries: [],
  };
  const records: string[] = [];
  for (const part of output.split('\0')) {
    if (part.startsWith('# ')) {
      for (const line of part.split('\n')) {
        if (line.startsWith('# ')) parseHeader(line, state);
        else if (line !== '') records.push(line);
      }
    } else if (part !== '') {
      records.push(part);
    }
  }

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record === undefined || record === '') {
      continue;
    }
    if (record.startsWith('1 ')) {
      const { metadata, path: filePath } = splitMetadataAndPath(record, 8);
      const xy = metadata[1] ?? '..';
      state.entries.push(getFileStatus('ordinary', xy[0] ?? '.', xy[1] ?? '.', filePath));
      continue;
    }
    if (record.startsWith('2 ')) {
      const { metadata, path: filePath } = splitMetadataAndPath(record, 9);
      const xy = metadata[1] ?? '..';
      const renameFrom = records[index + 1];
      if (renameFrom !== undefined) {
        index += 1;
      }
      state.entries.push(getFileStatus('rename', xy[0] ?? '.', xy[1] ?? '.', filePath, renameFrom));
      continue;
    }
    if (record.startsWith('u ')) {
      const { metadata, path: filePath } = splitMetadataAndPath(record, 10);
      const xy = metadata[1] ?? 'UU';
      state.entries.push(getFileStatus('conflict', xy[0] ?? 'U', xy[1] ?? 'U', filePath));
      continue;
    }
    if (record.startsWith('? ')) {
      state.entries.push(getFileStatus('untracked', '?', '?', record.slice(2)));
      continue;
    }
    if (record.startsWith('! ')) {
      state.entries.push(getFileStatus('ignored', '!', '!', record.slice(2)));
    }
  }
  return state;
};

export const toRepositoryStatus = (
  parsed: ParsedPorcelainStatus,
  inProgress: RepositoryStatus['inProgress'],
): RepositoryStatus => ({
  ...parsed,
  dirty: parsed.entries.some((entry) => entry.kind !== 'ignored'),
  inProgress,
});
