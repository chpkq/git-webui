import { describe, expect, it } from 'vitest';
import { parsePorcelainV2 } from './porcelain-parser.js';

describe('parsePorcelainV2', () => {
  it('parses branch metadata and paths containing spaces or newlines', () => {
    const output =
      '# branch.oid abc123\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +2 -1\n' +
      '1 .M N... 100644 100644 100644 abc abc file with spaces.txt\0' +
      '? path with\nnewline.txt\0';

    const parsed = parsePorcelainV2(output);

    expect(parsed).toMatchObject({
      head: 'abc123',
      branch: 'main',
      upstream: 'origin/main',
      ahead: 2,
      behind: 1,
    });
    expect(parsed.entries).toEqual([
      expect.objectContaining({ path: 'file with spaces.txt', unstaged: true }),
      expect.objectContaining({ path: 'path with\nnewline.txt', kind: 'untracked' }),
    ]);
  });

  it('parses a rename record with the original path as the next NUL field', () => {
    const output =
      '# branch.oid abc\n# branch.head main\n' +
      '2 R. N... 100644 100644 100644 abc def R100 renamed.txt\0old name.txt\0';

    const parsed = parsePorcelainV2(output);

    expect(parsed.entries[0]).toMatchObject({
      kind: 'rename',
      path: 'renamed.txt',
      renameFrom: 'old name.txt',
      staged: true,
    });
  });
});
