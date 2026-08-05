import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';

export interface LoadedEnvironment {
  environment: NodeJS.ProcessEnv;
  envFilePath: string | null;
}

const hasSensitiveEnvironment = (environment: NodeJS.ProcessEnv): boolean =>
  typeof environment.GIT_WEBUI_AUTH_PASSWORD === 'string' ||
  typeof environment.GIT_WEBUI_SESSION_SECRET === 'string';

const assertSecureEnvironmentFile = (envFilePath: string): void => {
  if (process.platform === 'win32') return;

  const mode = statSync(envFilePath).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new Error(`项目 .env 文件包含敏感配置且权限过宽，请先执行 chmod 600 ${envFilePath}。`);
  }
};

export const loadProjectEnvironment = (
  environment: NodeJS.ProcessEnv,
  projectRoot: string,
): LoadedEnvironment => {
  const envFilePath = path.join(projectRoot, '.env');
  if (!existsSync(envFilePath)) {
    return { environment: { ...environment }, envFilePath: null };
  }

  let fileEnvironment: NodeJS.ProcessEnv;
  try {
    fileEnvironment = parseEnv(readFileSync(envFilePath, 'utf8'));
  } catch {
    throw new Error(`项目 .env 文件格式不正确：${envFilePath}`);
  }

  if (hasSensitiveEnvironment(fileEnvironment)) assertSecureEnvironmentFile(envFilePath);

  return {
    // 已存在的进程环境优先，避免 .env 意外覆盖显式启动参数。
    environment: { ...fileEnvironment, ...environment },
    envFilePath,
  };
};
