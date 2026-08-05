import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';

const hasValue = (value, minimumLength) =>
  typeof value === 'string' && value.length >= minimumLength;

export const loadProjectEnvironment = (environment, projectRoot) => {
  const envFilePath = path.join(projectRoot, '.env');
  if (!existsSync(envFilePath)) {
    return {
      environment: { ...environment },
      envFilePath: null,
      fileEnvironment: {},
    };
  }

  let fileEnvironment;
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
    fileEnvironment,
  };
};

export const hasRequiredAuthSecrets = (environment) =>
  hasValue(environment.GIT_WEBUI_AUTH_PASSWORD, 12) &&
  hasValue(environment.GIT_WEBUI_SESSION_SECRET, 32);

export const hasSensitiveEnvironment = (environment) =>
  typeof environment.GIT_WEBUI_AUTH_PASSWORD === 'string' ||
  typeof environment.GIT_WEBUI_SESSION_SECRET === 'string';

export const assertSecureEnvironmentFile = (envFilePath) => {
  if (envFilePath === null || process.platform === 'win32') return;

  const mode = statSync(envFilePath).mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new Error(`项目 .env 文件包含敏感配置且权限过宽，请先执行 chmod 600 ${envFilePath}。`);
  }
};
