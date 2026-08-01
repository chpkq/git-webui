import { describe, expect, it } from 'vitest';
import { readServerConfig } from './config.js';

describe('readServerConfig', () => {
  it('defaults to loopback binding', () => {
    expect(readServerConfig({}).host).toBe('127.0.0.1');
  });

  it('rejects remote binding before security gates are complete', () => {
    expect(() => readServerConfig({ GIT_WEBUI_HOST: '0.0.0.0' })).toThrow(
      '当前版本只允许监听本机回环地址',
    );
  });
});
