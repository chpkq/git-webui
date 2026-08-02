import { GitWebUiError } from '@git-webui/shared';
import type { UserRole } from '@git-webui/shared';
import path from 'node:path';

export interface ServerConfig {
  host: string;
  port: number;
  version: string;
  allowedRoots: readonly string[];
  databasePath: string;
  role: UserRole;
  authEnabled?: boolean;
  authPassword?: string | null;
  sessionSecret?: string | null;
  sessionTtlMs?: number;
  cookieSecure?: boolean;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

export const readServerConfig = (env: NodeJS.ProcessEnv = process.env): ServerConfig => {
  const host = env.GIT_WEBUI_HOST ?? '127.0.0.1';
  const port = Number(env.GIT_WEBUI_PORT ?? '3001');
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new GitWebUiError('INVALID_REQUEST', 'GIT_WEBUI_PORT 必须是 1 到 65535 之间的整数。');
  }
  const isLoopback = LOOPBACK_HOSTS.has(host);
  const remoteEnabled = env.GIT_WEBUI_ENABLE_REMOTE === 'true';
  const authPassword = env.GIT_WEBUI_AUTH_PASSWORD ?? null;
  const sessionSecret = env.GIT_WEBUI_SESSION_SECRET ?? null;
  const authRequested = env.GIT_WEBUI_AUTH_ENABLED === 'true' || !isLoopback;
  if (!isLoopback && !remoteEnabled) {
    throw new GitWebUiError(
      'PERMISSION_DENIED',
      '当前版本只允许监听本机回环地址；远程监听必须显式开启并完成登录、权限和 CSRF 门禁。',
      { host },
    );
  }
  if (authRequested && (authPassword === null || authPassword.length < 12)) {
    throw new GitWebUiError(
      'PERMISSION_DENIED',
      '启用鉴权时必须设置至少 12 个字符的 GIT_WEBUI_AUTH_PASSWORD。',
    );
  }
  if (authRequested && (sessionSecret === null || sessionSecret.length < 32)) {
    throw new GitWebUiError(
      'PERMISSION_DENIED',
      '启用鉴权时必须设置至少 32 个字符的 GIT_WEBUI_SESSION_SECRET。',
    );
  }
  const allowedRoots = (env.GIT_WEBUI_ALLOWED_ROOTS ?? path.resolve(process.cwd(), '../..'))
    .split(path.delimiter)
    .map((root) => root.trim())
    .filter(Boolean);
  const role = env.GIT_WEBUI_ROLE ?? 'admin';
  if (!['viewer', 'editor', 'admin'].includes(role)) {
    throw new GitWebUiError('INVALID_REQUEST', 'GIT_WEBUI_ROLE 必须是 viewer、editor 或 admin。');
  }
  const sessionTtlMs = Number(env.GIT_WEBUI_SESSION_TTL_MS ?? String(8 * 60 * 60 * 1000));
  if (
    !Number.isInteger(sessionTtlMs) ||
    sessionTtlMs < 5 * 60 * 1000 ||
    sessionTtlMs > 7 * 24 * 60 * 60 * 1000
  ) {
    throw new GitWebUiError(
      'INVALID_REQUEST',
      'GIT_WEBUI_SESSION_TTL_MS 必须在 5 分钟到 7 天之间。',
    );
  }
  return {
    host,
    port,
    version: env.GIT_WEBUI_VERSION ?? '0.1.0',
    allowedRoots,
    databasePath:
      env.GIT_WEBUI_DATABASE ?? path.resolve(process.cwd(), '../../data/git-webui.sqlite'),
    role: role as UserRole,
    authEnabled: authRequested,
    authPassword,
    sessionSecret,
    sessionTtlMs,
    cookieSecure: env.GIT_WEBUI_COOKIE_SECURE === 'true',
  };
};
