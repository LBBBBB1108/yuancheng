import { describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';

describe('GET /health', () => {
  it('returns a Chinese-safe machine-readable health response', async () => {
    const app = await buildApp({
      host: '127.0.0.1',
      port: 10000,
      databaseUrl: 'postgresql://unused',
      adminWebOrigin: 'http://localhost:5173',
      sessionSecret: '0123456789abcdef0123456789abcdef',
      publicServerUrl: 'http://localhost:10000',
      deploymentMode: 'test',
      nodeEnv: 'test',
    });

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      mode: 'test',
      database: 'not_checked',
    });
    await app.close();
  });
});

describe('administrator HTTP API', () => {
  it('sets an HttpOnly session cookie after a valid login', async () => {
    const app = await buildApp(
      {
        host: '127.0.0.1',
        port: 10000,
        databaseUrl: 'postgresql://unused',
        adminWebOrigin: 'http://localhost:5173',
        sessionSecret: '0123456789abcdef0123456789abcdef',
        publicServerUrl: 'http://localhost:10000',
        deploymentMode: 'test',
        nodeEnv: 'test',
      },
      {
        adminAuth: {
          login: async () => ({
            admin: { id: 'admin-id', displayName: '测试管理员' },
            refreshToken: 'refresh-token',
            csrfToken: 'csrf-token',
            expiresAt: new Date('2026-10-28T08:00:00.000Z'),
          }),
          authenticate: async () => ({ id: 'admin-id', permissions: ['devices.read'] }),
          authenticateMutation: async () => ({
            id: 'admin-id',
            permissions: ['devices.read', 'devices.manage'],
          }),
        },
        devices: {
          listForAdministrator: async () => [],
        },
        pairing: {
          create: async () => ({
            enrollment: {
              formatVersion: 1,
              serverUrl: 'http://localhost:10000',
              token: 'x'.repeat(43),
              requestedDeviceName: '测试机',
              expiresAt: '2026-10-21T08:30:00.000Z',
            },
            expiresAt: new Date('2026-10-21T08:30:00.000Z'),
          }),
        },
        enrollment: {
          enroll: async () => ({ status: 'registered', deviceId: 'device-id' }),
        },
        deviceAuth: {
          createChallenge: () => ({ nonce: 'x'.repeat(43), expiresAt: new Date(Date.now() + 15_000) }),
          authenticate: async () => ({ status: 'invalid_signature' }),
          recordHeartbeat: async () => true,
        },
      },
    );

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'admin', password: 'secret' },
    });

    expect(login.statusCode).toBe(200);
    expect(login.json()).toEqual({
      admin: { id: 'admin-id', displayName: '测试管理员' },
      csrfToken: 'csrf-token',
      expiresAt: '2026-10-28T08:00:00.000Z',
    });
    expect(login.headers['set-cookie']).toContain('HttpOnly');

    const devices = await app.inject({
      method: 'GET',
      url: '/api/v1/devices',
      headers: { cookie: 'yc_session=valid-session' },
    });
    expect(devices.statusCode).toBe(200);
    expect(devices.json()).toEqual({ devices: [] });

    const pairing = await app.inject({
      method: 'POST',
      url: '/api/v1/pairing-packages',
      headers: {
        cookie: 'yc_session=valid-session',
        'x-csrf-token': 'valid-csrf-token',
      },
      payload: { requestedDeviceName: '测试机' },
    });
    expect(pairing.statusCode).toBe(201);
    expect(pairing.json().enrollment.token).toBe('x'.repeat(43));

    const enrollment = await app.inject({
      method: 'POST',
      url: '/api/v1/devices/enroll',
      payload: {
        token: 'x'.repeat(43),
        deviceName: '测试机',
        publicKey: Buffer.alloc(32, 1).toString('base64'),
        osVersion: 'Windows 11',
        clientVersion: '0.1.0-test',
      },
    });
    expect(enrollment.statusCode).toBe(201);
    expect(enrollment.json()).toEqual({ deviceId: 'device-id' });
    await app.close();
  });

  it('rejects device listing without an authenticated session', async () => {
    const app = await buildApp(
      {
        host: '127.0.0.1',
        port: 10000,
        databaseUrl: 'postgresql://unused',
        adminWebOrigin: 'http://localhost:5173',
        sessionSecret: '0123456789abcdef0123456789abcdef',
        publicServerUrl: 'http://localhost:10000',
        deploymentMode: 'test',
        nodeEnv: 'test',
      },
      {
        adminAuth: {
          login: async () => null,
          authenticate: async () => null,
          authenticateMutation: async () => null,
        },
        devices: { listForAdministrator: async () => [] },
        pairing: {
          create: async () => {
            throw new Error('不应调用');
          },
        },
        enrollment: {
          enroll: async () => ({ status: 'invalid_token' }),
        },
        deviceAuth: {
          createChallenge: () => ({ nonce: 'x'.repeat(43), expiresAt: new Date(Date.now() + 15_000) }),
          authenticate: async () => ({ status: 'invalid_signature' }),
          recordHeartbeat: async () => true,
        },
      },
    );

    const response = await app.inject({ method: 'GET', url: '/api/v1/devices' });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: '请先登录' });
    await app.close();
  });
});
