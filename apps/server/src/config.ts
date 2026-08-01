import { GitWebUiError } from '@git-webui/shared';

export interface ServerConfig {
  host: string;
  port: number;
  version: string;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

export const readServerConfig = (env: NodeJS.ProcessEnv = process.env): ServerConfig => {
  const host = env.GIT_WEBUI_HOST ?? '127.0.0.1';
  const port = Number(env.GIT_WEBUI_PORT ?? '3000');
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new GitWebUiError('INVALID_REQUEST', 'GIT_WEBUI_PORT 必须是 1 到 65535 之间的整数。');
  }
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new GitWebUiError(
      'PERMISSION_DENIED',
      '当前版本只允许监听本机回环地址；远程监听需等待登录、权限和 CSRF 门禁完成。',
      { host },
    );
  }
  return { host, port, version: env.GIT_WEBUI_VERSION ?? '0.1.0' };
};
