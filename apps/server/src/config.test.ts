import { describe, expect, it } from 'vitest';
import { readServerConfig } from './config.js';

describe('readServerConfig', () => {
  it('defaults to all-interface binding but retains remote security gates', () => {
    expect(() => readServerConfig({})).toThrow('当前版本只允许监听本机回环地址');
    const config = readServerConfig({
      GIT_WEBUI_ENABLE_REMOTE: 'true',
      GIT_WEBUI_AUTH_PASSWORD: 'correct horse battery staple',
      GIT_WEBUI_SESSION_SECRET: '01234567890123456789012345678901',
    });
    expect(config).toMatchObject({ host: '0.0.0.0', role: 'admin', authEnabled: true });
  });

  it('rejects remote binding before security gates are complete', () => {
    expect(() => readServerConfig({ GIT_WEBUI_HOST: '0.0.0.0' })).toThrow(
      '当前版本只允许监听本机回环地址',
    );
  });

  it('allows remote binding only with explicit auth configuration', () => {
    const config = readServerConfig({
      GIT_WEBUI_HOST: '0.0.0.0',
      GIT_WEBUI_ENABLE_REMOTE: 'true',
      GIT_WEBUI_AUTH_PASSWORD: 'correct horse battery staple',
      GIT_WEBUI_SESSION_SECRET: '01234567890123456789012345678901',
      GIT_WEBUI_ROLE: 'editor',
    });
    expect(config).toMatchObject({ host: '0.0.0.0', authEnabled: true, role: 'editor' });
  });
});
