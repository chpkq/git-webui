import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface E2eFixture {
  root: string;
  repositoryPath: string;
  remotePath: string;
  otherPath: string;
}

export const createE2eFixture = async (): Promise<E2eFixture> => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'git-webui-e2e-repository-'));
  const repositoryPath = path.join(root, 'repository');
  const remotePath = path.join(root, 'remote.git');
  const otherPath = path.join(root, 'other');
  await mkdir(repositoryPath);
  await runGit(root, ['init', '--bare', '--initial-branch=main', remotePath]);
  await runGit(repositoryPath, ['init', '-b', 'main']);
  await runGit(repositoryPath, ['config', 'user.name', '浏览器测试']);
  await runGit(repositoryPath, ['config', 'user.email', 'e2e@example.com']);
  await writeFile(path.join(repositoryPath, 'readme.md'), '# e2e\n');
  await runGit(repositoryPath, ['add', '--', 'readme.md']);
  await runGit(repositoryPath, ['commit', '-m', 'E2E 初始提交']);
  await runGit(repositoryPath, ['remote', 'add', 'origin', remotePath]);
  await runGit(repositoryPath, ['push', '--set-upstream', 'origin', 'main']);
  await runGit(root, ['clone', remotePath, otherPath]);
  await runGit(otherPath, ['config', 'user.name', '远端浏览器测试']);
  await runGit(otherPath, ['config', 'user.email', 'e2e-remote@example.com']);
  return { root, repositoryPath, remotePath, otherPath };
};

export const runGit = async (cwd: string, args: string[]): Promise<void> => {
  await execFileAsync('git', args, {
    cwd,
    maxBuffer: 2 * 1024 * 1024,
    shell: false,
  });
};

export const removeE2eFixture = async (fixture: E2eFixture): Promise<void> => {
  await rm(fixture.root, { recursive: true, force: true });
};
