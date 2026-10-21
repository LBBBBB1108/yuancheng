import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config.js';

const validEnvironment = {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: '10000',
  DATABASE_URL: 'postgresql://yuancheng_app:secret@127.0.0.1:5432/yuancheng_test',
  ADMIN_WEB_ORIGIN: 'http://localhost:5173',
  SESSION_SECRET: '0123456789abcdef0123456789abcdef',
  PUBLIC_SERVER_URL: 'http://localhost:10000',
  DEPLOYMENT_MODE: 'test',
};

describe('loadConfig', () => {
  it('loads an explicit test configuration', () => {
    const config = loadConfig(validEnvironment);

    expect(config).toMatchObject({
      host: '127.0.0.1',
      port: 10000,
      deploymentMode: 'test',
    });
  });

  it('rejects short session secrets and unsupported deployment modes', () => {
    expect(() =>
      loadConfig({ ...validEnvironment, SESSION_SECRET: 'short' }),
    ).toThrow('SESSION_SECRET 至少需要 32 个字符');

    expect(() =>
      loadConfig({ ...validEnvironment, DEPLOYMENT_MODE: 'unsafe' }),
    ).toThrow('DEPLOYMENT_MODE 必须是 test 或 production');
  });
});
