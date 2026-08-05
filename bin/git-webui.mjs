#!/usr/bin/env node

import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { request } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  assertSecureEnvironmentFile,
  hasRequiredAuthSecrets,
  loadProjectEnvironment,
} from '../scripts/environment.mjs';

const cliFile = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(cliFile), '..');
const launchAgentLabel = 'dev.git-webui.service';
const launchAgentFileName = `${launchAgentLabel}.plist`;
const safeLaunchEnvironmentKeys = [
  'GIT_WEBUI_ALLOWED_ROOTS',
  'GIT_WEBUI_AUTH_ENABLED',
  'GIT_WEBUI_COOKIE_SECURE',
  'GIT_WEBUI_DATABASE',
  'GIT_WEBUI_ENABLE_REMOTE',
  'GIT_WEBUI_HOST',
  'GIT_WEBUI_ROLE',
  'GIT_WEBUI_SERVER_PORT',
  'GIT_WEBUI_SESSION_TTL_MS',
  'GIT_WEBUI_STATE_DIR',
  'GIT_WEBUI_LOG_DIR',
  'GIT_WEBUI_WEB_HOST',
  'GIT_WEBUI_WEB_PORT',
];

function parsePort(value, fallback, name) {
  const port = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} 必须是 1 到 65535 之间的整数。`);
  }
  return port;
}

export function getServicePaths({
  env = process.env,
  homeDirectory = os.homedir(),
  root = projectRoot,
  executable = cliFile,
} = {}) {
  const stateDirectory = path.resolve(
    env.GIT_WEBUI_STATE_DIR ??
      (process.platform === 'darwin'
        ? path.join(homeDirectory, 'Library', 'Application Support', 'git-webui')
        : path.join(homeDirectory, '.local', 'state', 'git-webui')),
  );
  const logDirectory = path.resolve(
    env.GIT_WEBUI_LOG_DIR ??
      (process.platform === 'darwin'
        ? path.join(homeDirectory, 'Library', 'Logs', 'git-webui')
        : path.join(stateDirectory, 'logs')),
  );
  const launchAgentPath = path.resolve(
    env.GIT_WEBUI_LAUNCH_AGENT_PATH ??
      path.join(homeDirectory, 'Library', 'LaunchAgents', launchAgentFileName),
  );

  return {
    executable: path.resolve(executable),
    projectRoot: path.resolve(root),
    stateDirectory,
    logDirectory,
    pidFile: path.join(stateDirectory, 'service.pid'),
    instanceFile: path.join(stateDirectory, 'instance.json'),
    logFile: path.join(logDirectory, 'service.log'),
    launchAgentPath,
    launchAgentLabel,
  };
}

export function getServiceConfig({
  env = process.env,
  environmentFilePath = null,
  environmentFileValues = {},
  ...options
} = {}) {
  const paths = getServicePaths({ env, ...options });
  const webPort = parsePort(env.GIT_WEBUI_WEB_PORT, 9001, 'GIT_WEBUI_WEB_PORT');
  const serverPort = parsePort(env.GIT_WEBUI_SERVER_PORT, 3001, 'GIT_WEBUI_SERVER_PORT');

  return {
    env,
    paths,
    webPort,
    serverPort,
    healthUrl: `http://127.0.0.1:${webPort}/health`,
    environmentFilePath,
    environmentFileValues,
  };
}

function ensureDirectories(config) {
  mkdirSync(config.paths.stateDirectory, { recursive: true, mode: 0o700 });
  mkdirSync(config.paths.logDirectory, { recursive: true, mode: 0o700 });
  chmodSync(config.paths.stateDirectory, 0o700);
  chmodSync(config.paths.logDirectory, 0o700);
}

function readPid(config) {
  if (!existsSync(config.paths.pidFile)) return null;

  const value = Number(readFileSync(config.paths.pidFile, 'utf8').trim());
  return Number.isInteger(value) && value > 0 ? value : null;
}

function readInstance(config) {
  if (!existsSync(config.paths.instanceFile)) return null;

  try {
    const value = JSON.parse(readFileSync(config.paths.instanceFile, 'utf8'));
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

function removeStateFiles(config, expectedPid = null) {
  if (expectedPid !== null && readPid(config) !== expectedPid) return;
  rmSync(config.paths.pidFile, { force: true });
  rmSync(config.paths.instanceFile, { force: true });
}

function processCommand(pid) {
  const ps = process.platform === 'darwin' ? '/bin/ps' : 'ps';
  const result = spawnSync(ps, ['-p', String(pid), '-o', 'command='], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024,
  });
  if (result.status !== 0) return '';
  return result.stdout.trim();
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

function isManagedProcess(config, pid) {
  if (!isProcessRunning(pid)) return false;

  const command = processCommand(pid);
  return (
    command.includes(path.basename(config.paths.executable)) &&
    command.includes('serve') &&
    command.includes('--foreground')
  );
}

function getRunningPid(config) {
  const pid = readPid(config);
  if (!pid || !isManagedProcess(config, pid)) {
    removeStateFiles(config);
    return null;
  }
  return pid;
}

function writeInstanceState(config, pid, launchMode) {
  ensureDirectories(config);
  writeFileSync(config.paths.pidFile, `${pid}\n`, { mode: 0o600 });
  chmodSync(config.paths.pidFile, 0o600);

  writeFileSync(
    config.paths.instanceFile,
    `${JSON.stringify(
      {
        pid,
        launchMode,
        projectRoot: config.paths.projectRoot,
        executable: config.paths.executable,
        webPort: config.webPort,
        serverPort: config.serverPort,
        healthUrl: config.healthUrl,
        logFile: config.paths.logFile,
        startedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  chmodSync(config.paths.instanceFile, 0o600);
}

function checkHealth(config, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const healthRequest = request(config.healthUrl, { timeout: timeoutMs }, (response) => {
      response.resume();
      resolve(
        response.statusCode !== undefined &&
          response.statusCode >= 200 &&
          response.statusCode < 300,
      );
    });

    healthRequest.once('timeout', () => {
      healthRequest.destroy();
      resolve(false);
    });
    healthRequest.once('error', () => resolve(false));
    healthRequest.end();
  });
}

export async function waitForHealth(config, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await checkHealth(config)) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  return false;
}

function writeAtomic(filePath, contents) {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, contents, { mode: 0o600 });
  chmodSync(temporaryPath, 0o600);
  renameSync(temporaryPath, filePath);
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function plistString(value) {
  return `    <string>${escapeXml(value)}</string>`;
}

export function renderLaunchAgentPlist({
  label = launchAgentLabel,
  nodePath = process.execPath,
  executable = cliFile,
  workingDirectory = projectRoot,
  standardOutPath,
  standardErrorPath,
  environment = {},
} = {}) {
  const environmentEntries = Object.entries(environment)
    .filter(([, value]) => value !== undefined && value !== '')
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([key, value]) => [`    <key>${escapeXml(key)}</key>`, plistString(value)]);
  const environmentBlock =
    environmentEntries.length === 0
      ? ''
      : `\n  <key>EnvironmentVariables</key>\n  <dict>\n${environmentEntries.join('\n')}\n  </dict>`;
  const outputPathBlock = [
    standardOutPath === undefined
      ? ''
      : `  <key>StandardOutPath</key>\n${plistString(standardOutPath)}`,
    standardErrorPath === undefined
      ? ''
      : `  <key>StandardErrorPath</key>\n${plistString(standardErrorPath)}`,
  ]
    .filter(Boolean)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
${plistString(label)}
  <key>ProgramArguments</key>
  <array>
${[nodePath, executable, 'serve', '--foreground'].map(plistString).join('\n')}
  </array>
  <key>WorkingDirectory</key>
${plistString(workingDirectory)}
${outputPathBlock ? `${outputPathBlock}\n` : ''}  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>${environmentBlock}
</dict>
</plist>
`;
}

export function getLaunchEnvironment(config) {
  const environment = { GIT_WEBUI_LAUNCH_MODE: 'launchd' };
  for (const key of safeLaunchEnvironmentKeys) {
    if (config.env[key] !== undefined) environment[key] = config.env[key];
  }
  return environment;
}

function getLaunchdTarget() {
  if (typeof process.getuid !== 'function') {
    throw new Error('当前 Node 进程不支持获取 macOS 用户会话。');
  }
  return `gui/${process.getuid()}`;
}

function launchctl(args, { ignoreFailure = false } = {}) {
  try {
    return execFileSync('/bin/launchctl', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    if (ignoreFailure) return null;
    const detail = String(error?.stderr ?? error?.message ?? '').trim();
    throw new Error(`launchctl ${args.join(' ')} 执行失败${detail ? `：${detail}` : '。'}`);
  }
}

function isLaunchdLoaded() {
  if (process.platform !== 'darwin') return false;
  try {
    launchctl(['print', `${getLaunchdTarget()}/${launchAgentLabel}`]);
    return true;
  } catch {
    return false;
  }
}

function unloadLaunchAgent() {
  launchctl(['bootout', `${getLaunchdTarget()}/${launchAgentLabel}`], {
    ignoreFailure: true,
  });
}

function assertMacOsStartup() {
  if (process.platform !== 'darwin') {
    throw new Error('startup 命令目前只支持 macOS LaunchAgent。');
  }
}

function assertLaunchAgentEnvironmentSafe(config) {
  const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1']);
  const serverHost = config.env.GIT_WEBUI_HOST ?? '127.0.0.1';
  const authRequested =
    config.env.GIT_WEBUI_AUTH_ENABLED === 'true' || !loopbackHosts.has(serverHost);

  if (!authRequested) return;

  if (
    config.environmentFilePath === null ||
    !hasRequiredAuthSecrets(config.environmentFileValues)
  ) {
    throw new Error(
      'startup enable 不会把密码或 session secret 写入 LaunchAgent；请在项目 .env 中配置完整鉴权秘密。',
    );
  }

  assertSecureEnvironmentFile(config.environmentFilePath);
}

export function startupStatus(config) {
  assertMacOsStartup();
  const configured = existsSync(config.paths.launchAgentPath);
  const loaded = isLaunchdLoaded();
  return { configured, loaded, path: config.paths.launchAgentPath };
}

function writeLaunchAgent(config) {
  mkdirSync(path.dirname(config.paths.launchAgentPath), { recursive: true, mode: 0o700 });
  const plist = renderLaunchAgentPlist({
    executable: config.paths.executable,
    workingDirectory: config.paths.projectRoot,
    standardOutPath: config.paths.logFile,
    standardErrorPath: config.paths.logFile,
    environment: getLaunchEnvironment(config),
  });
  writeAtomic(config.paths.launchAgentPath, plist);
  chmodSync(config.paths.launchAgentPath, 0o600);
}

export function startupEnable(config) {
  assertMacOsStartup();
  assertLaunchAgentEnvironmentSafe(config);
  const runningPid = getRunningPid(config);
  const runningState = readInstance(config);
  if (runningPid && runningState?.launchMode !== 'launchd') {
    throw new Error(`服务当前由手动进程运行（PID: ${runningPid}），请先执行 git-webui stop。`);
  }

  ensureDirectories(config);
  unloadLaunchAgent();
  writeLaunchAgent(config);

  try {
    launchctl(['bootstrap', getLaunchdTarget(), config.paths.launchAgentPath]);
    launchctl(['kickstart', '-k', `${getLaunchdTarget()}/${launchAgentLabel}`]);
  } catch (error) {
    throw new Error(`${error.message}；LaunchAgent 文件已保留：${config.paths.launchAgentPath}`);
  }

  return config.paths.launchAgentPath;
}

export function startupDisable(config) {
  assertMacOsStartup();
  unloadLaunchAgent();

  if (existsSync(config.paths.launchAgentPath)) {
    const contents = readFileSync(config.paths.launchAgentPath, 'utf8');
    if (!contents.includes(`<string>${launchAgentLabel}</string>`)) {
      throw new Error(`拒绝删除非 git-webui 创建的 LaunchAgent：${config.paths.launchAgentPath}`);
    }
    rmSync(config.paths.launchAgentPath, { force: true });
  }
}

function installForegroundCleanup(config) {
  process.once('exit', () => {
    removeStateFiles(config, process.pid);
  });
}

async function startCommand(config) {
  ensureDirectories(config);
  const existingPid = getRunningPid(config);
  if (existingPid) {
    console.log(`Git WebUI 已在运行，PID: ${existingPid}`);
    return;
  }

  const logFd = openSync(config.paths.logFile, 'a', 0o600);
  let child;
  try {
    child = spawn(process.execPath, [config.paths.executable, 'serve', '--foreground'], {
      cwd: config.paths.projectRoot,
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: {
        ...config.env,
        GIT_WEBUI_LAUNCH_MODE: 'daemon',
      },
    });
  } finally {
    closeSync(logFd);
  }

  if (!child.pid) throw new Error(`无法启动服务进程，请查看日志：${config.paths.logFile}`);
  child.unref();
  writeInstanceState(config, child.pid, 'daemon');

  if (!(await waitForHealth(config))) {
    try {
      process.kill(child.pid, 'SIGTERM');
    } catch {
      // 服务可能已自行退出。
    }
    removeStateFiles(config, child.pid);
    throw new Error(`服务启动失败，健康检查超时。请查看日志：${config.paths.logFile}`);
  }

  console.log('Git WebUI 已启动');
  console.log(`PID: ${child.pid}`);
  console.log(`地址: http://127.0.0.1:${config.webPort}`);
  console.log(`日志: ${config.paths.logFile}`);
}

async function stopCommand(config) {
  const pid = getRunningPid(config);
  if (!pid) {
    console.log('Git WebUI 当前未运行');
    return;
  }

  const state = readInstance(config);
  if (state?.launchMode === 'launchd' && isLaunchdLoaded()) {
    unloadLaunchAgent();
  } else {
    try {
      process.kill(pid, 'SIGTERM');
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
  }

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (!isProcessRunning(pid)) {
      removeStateFiles(config, pid);
      console.log('Git WebUI 已停止');
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  console.warn('进程未正常退出，发送 SIGKILL');
  try {
    process.kill(pid, 'SIGKILL');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
  removeStateFiles(config, pid);
}

async function restartCommand(config) {
  const pid = getRunningPid(config);
  if (pid && readInstance(config)?.launchMode === 'launchd' && isLaunchdLoaded()) {
    launchctl(['kickstart', '-k', `${getLaunchdTarget()}/${launchAgentLabel}`]);
    if (!(await waitForHealth(config))) {
      throw new Error(`服务重启后健康检查失败。请查看日志：${config.paths.logFile}`);
    }
    console.log('Git WebUI 已重启');
    console.log(`PID: ${getRunningPid(config) ?? 'unknown'}`);
    return;
  }

  await stopCommand(config);
  await startCommand(config);
}

function logsCommand(config, args) {
  ensureDirectories(config);
  if (!existsSync(config.paths.logFile)) writeFileSync(config.paths.logFile, '', { mode: 0o600 });

  const follow = args.includes('-f') || args.includes('--follow');
  const tail = spawn(
    'tail',
    follow ? ['-n', '100', '-f', config.paths.logFile] : ['-n', '100', config.paths.logFile],
    {
      stdio: 'inherit',
    },
  );
  tail.once('exit', (code) => {
    process.exitCode = code ?? 0;
  });
}

async function serveForegroundCommand(config) {
  ensureDirectories(config);
  installForegroundCleanup(config);
  writeInstanceState(
    config,
    process.pid,
    config.env.GIT_WEBUI_LAUNCH_MODE === 'launchd' ? 'launchd' : 'foreground',
  );

  const sourceEntry = path.join(config.paths.projectRoot, 'scripts', 'start-standalone.mjs');
  const releaseEntry = path.join(config.paths.projectRoot, 'start.mjs');
  const entry = existsSync(releaseEntry) ? releaseEntry : sourceEntry;
  if (!existsSync(entry)) throw new Error(`找不到 Standalone 启动器：${entry}`);

  await import(pathToFileURL(entry).href);
}

function printHelp() {
  console.log(`Git WebUI

用法：
  git-webui [start]
  git-webui stop
  git-webui restart
  git-webui status
  git-webui logs [-f]
  git-webui serve --foreground
  git-webui startup enable
  git-webui startup disable
  git-webui startup status
`);
}

async function statusCommand(config) {
  const pid = getRunningPid(config);
  if (!pid) {
    console.log('● git-webui — stopped');
    return;
  }

  const healthy = await checkHealth(config);
  console.log('● git-webui — running');
  console.log(`  PID:    ${pid}`);
  console.log(`  Health: ${healthy ? 'ok' : 'unreachable'}`);
  console.log(`  URL:    http://127.0.0.1:${config.webPort}`);
  console.log(`  Log:    ${config.paths.logFile}`);
}

export async function main(argv = process.argv.slice(2), options = {}) {
  const hasCustomEnvironment = Object.prototype.hasOwnProperty.call(options, 'env');
  const environmentSource = hasCustomEnvironment
    ? {
        environment: options.env ?? {},
        envFilePath: null,
        fileEnvironment: {},
      }
    : loadProjectEnvironment(process.env, options.root ?? projectRoot);
  Object.assign(process.env, environmentSource.environment);
  const config = getServiceConfig({
    ...options,
    env: environmentSource.environment,
    environmentFilePath: environmentSource.envFilePath,
    environmentFileValues: environmentSource.fileEnvironment,
  });
  const [command = 'start', ...args] = argv;

  switch (command) {
    case 'start':
      await startCommand(config);
      break;
    case 'stop':
      await stopCommand(config);
      break;
    case 'restart':
      await restartCommand(config);
      break;
    case 'status':
      await statusCommand(config);
      break;
    case 'logs':
      logsCommand(config, args);
      break;
    case 'serve':
      if (!args.includes('--foreground')) throw new Error('serve 命令必须使用 --foreground。');
      await serveForegroundCommand(config);
      break;
    case 'startup': {
      const action = args[0];
      if (args.length !== 1 || !['enable', 'disable', 'status'].includes(action)) {
        throw new Error('startup 命令需要 enable、disable 或 status。');
      }
      if (action === 'enable') {
        const launchAgentPath = startupEnable(config);
        console.log(`Git WebUI 登录启动已启用：${launchAgentPath}`);
      } else if (action === 'disable') {
        startupDisable(config);
        console.log('Git WebUI 登录启动已禁用');
      } else {
        const status = startupStatus(config);
        console.log(`配置文件：${status.path}`);
        console.log(`文件状态：${status.configured ? '已配置' : '未配置'}`);
        console.log(`加载状态：${status.loaded ? '已加载' : '未加载'}`);
      }
      break;
    }
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      break;
    default:
      throw new Error(`未知命令：${command}`);
  }
}

const directEntry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (directEntry === cliFile || path.basename(directEntry) === path.basename(cliFile)) {
  main().catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  });
}
