import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { log } from 'node:console';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));
const outputRoot = path.join(projectRoot, 'release', `git-webui-v${packageJson.version}`);
const serverOutput = path.join(outputRoot, 'server');

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
execFileSync(
  pnpmCommand,
  ['--filter', '@git-webui/server', 'deploy', '--prod', '--legacy', serverOutput],
  { cwd: projectRoot, stdio: 'inherit' },
);

await cp(path.join(projectRoot, 'apps/web/dist'), path.join(outputRoot, 'web'), {
  recursive: true,
});
await cp(
  path.join(projectRoot, 'scripts/start-standalone.mjs'),
  path.join(outputRoot, 'start.mjs'),
);
await cp(path.join(projectRoot, 'README.md'), path.join(outputRoot, 'README.md'));
await cp(path.join(projectRoot, '.env.example'), path.join(outputRoot, '.env.example'));
await mkdir(path.join(outputRoot, 'docs'), { recursive: true });
await cp(
  path.join(projectRoot, 'project-execution-plan.md'),
  path.join(outputRoot, 'project-execution-plan.md'),
);
await cp(
  path.join(projectRoot, 'docs/release-checklist.md'),
  path.join(outputRoot, 'docs/release-checklist.md'),
);
await writeFile(path.join(outputRoot, 'VERSION'), `${packageJson.version}\n`, 'utf8');

log(`Standalone 包已生成：${outputRoot}`);
