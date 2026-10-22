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
          getSession: async () => ({
            admin: { id: 'admin-id', displayName: '测试管理员' }, permissions: ['devices.read'],
            expiresAt: new Date('2026-10-28T08:00:00.000Z'),
          }),
          refresh: async () => ({
            admin: { id: 'admin-id', displayName: '测试管理员' }, refreshToken: 'new-refresh-token',
            csrfToken: 'new-csrf-token', expiresAt: new Date('2026-10-28T08:00:00.000Z'),
          }),
          logout: async () => true,
          logoutAll: async () => true,
          rotateCsrf: async () => 'new-csrf-token',
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

  it('restores, rotates, and revokes an administrator session only from the trusted origin', async () => {
    const app = await buildApp({
      host: '127.0.0.1', port: 10000, databaseUrl: 'postgresql://unused',
      adminWebOrigin: 'http://localhost:5173', sessionSecret: '0123456789abcdef0123456789abcdef',
      publicServerUrl: 'http://localhost:10000', deploymentMode: 'test', nodeEnv: 'test',
    }, createServices());
    const trustedHeaders = {
      cookie: 'yc_session=valid-session', origin: 'http://localhost:5173', 'x-csrf-token': 'valid-csrf-token',
    };

    const session = await app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: trustedHeaders });
    expect(session.statusCode).toBe(200);
    expect(session.json()).toEqual({
      admin: { id: 'admin-id', displayName: '测试管理员' }, permissions: ['devices.read'],
      expiresAt: '2026-10-28T08:00:00.000Z',
    });
    const refresh = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: trustedHeaders });
    expect(refresh.statusCode).toBe(200);
    expect(refresh.headers['set-cookie']).toContain('yc_session=new-refresh-token');
    expect(refresh.json().csrfToken).toBe('new-csrf-token');
    const logout = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: trustedHeaders });
    expect(logout.statusCode).toBe(204);
    expect(logout.headers['set-cookie']).toContain('yc_session=;');
    const csrf = await app.inject({ method: 'GET', url: '/api/v1/auth/csrf', headers: trustedHeaders });
    expect(csrf.statusCode).toBe(200);
    expect(csrf.headers['cache-control']).toContain('no-store');
    await expect(app.inject({ method: 'POST', url: '/api/v1/auth/refresh', headers: {
      ...trustedHeaders, origin: 'http://untrusted.example',
    } })).resolves.toMatchObject({ statusCode: 403 });
    await app.close();
  });

  it('updates and revokes only managed devices from the trusted origin', async () => {
    const app = await buildApp({
      host: '127.0.0.1', port: 10000, databaseUrl: 'postgresql://unused',
      adminWebOrigin: 'http://localhost:5173', sessionSecret: '0123456789abcdef0123456789abcdef',
      publicServerUrl: 'http://localhost:10000', deploymentMode: 'test', nodeEnv: 'test',
    }, createServices());
    const headers = {
      cookie: 'yc_session=valid-session', origin: 'http://localhost:5173',
      'x-csrf-token': 'valid-csrf-token', 'content-type': 'application/json',
    };
    const deviceUrl = '/api/v1/devices/19d7b60c-f258-4be3-8e5a-698670687843';

    const update = await app.inject({ method: 'PATCH', url: deviceUrl, headers, payload: { name: '财务机', groupName: '财务部' } });
    expect(update.statusCode).toBe(204);
    const revoke = await app.inject({ method: 'DELETE', url: deviceUrl, headers: { ...headers, 'content-type': undefined } });
    expect(revoke.statusCode).toBe(204);
    const untrusted = await app.inject({ method: 'DELETE', url: deviceUrl, headers: { ...headers, origin: 'http://untrusted.example', 'content-type': undefined } });
    expect(untrusted.statusCode).toBe(403);
    await app.close();
  });

  it('reads candidates and explicitly grants test authorization only from the trusted origin', async () => {
    const grants: unknown[] = [];
    const app = await buildApp({
      host: '127.0.0.1', port: 10000, databaseUrl: 'postgresql://unused',
      adminWebOrigin: 'http://localhost:5173', sessionSecret: '0123456789abcdef012345678789abcdef',
      publicServerUrl: 'http://localhost:10000', deploymentMode: 'test', nodeEnv: 'test',
    }, {
      ...createServices(),
      adminAuth: { ...createServices().adminAuth, authenticate: async () => ({ id: 'admin-id', permissions: ['devices.manage'] }) },
      testAuthorizations: {
        get: async () => ({ authorization: null, candidates: [{ id: '29d7b60c-f258-4be3-8e5a-698670687843', displayName: '指定管理员' }] }),
        grant: async (request) => { grants.push(request); return 'granted' as const; },
        getActiveForDevice: async () => null,
      },
    });
    const deviceUrl = '/api/v1/devices/19d7b60c-f258-4be3-8e5a-698670687843/test-authorization';
    const headers = { cookie: 'yc_session=valid-session', origin: 'http://localhost:5173', 'x-csrf-token': 'valid-csrf-token' };

    const details = await app.inject({ method: 'GET', url: deviceUrl, headers });
    expect(details.statusCode).toBe(200);
    expect(details.json()).toEqual({ authorization: null, candidates: [{ id: '29d7b60c-f258-4be3-8e5a-698670687843', displayName: '指定管理员' }] });
    const grant = await app.inject({ method: 'POST', url: deviceUrl, headers: { ...headers, 'content-type': 'application/json' }, payload: { administratorId: '29d7b60c-f258-4be3-8e5a-698670687843' } });
    expect(grant.statusCode).toBe(200);
    expect(grants).toHaveLength(1);
    await expect(app.inject({ method: 'POST', url: deviceUrl, headers: { ...headers, origin: 'http://untrusted.example', 'content-type': 'application/json' }, payload: { administratorId: '29d7b60c-f258-4be3-8e5a-698670687843' } })).resolves.toMatchObject({ statusCode: 403 });
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
          getSession: async () => null,
          refresh: async () => null,
          logout: async () => false,
          logoutAll: async () => false,
          rotateCsrf: async () => null,
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

function createServices() {
  return {
    adminAuth: {
      login: async () => null,
      authenticate: async () => null,
      authenticateMutation: async () => ({ id: 'admin-id', permissions: ['devices.read', 'devices.manage'] }),
      getSession: async () => ({ admin: { id: 'admin-id', displayName: '测试管理员' }, permissions: ['devices.read'], expiresAt: new Date('2026-10-28T08:00:00.000Z') }),
      refresh: async () => ({ admin: { id: 'admin-id', displayName: '测试管理员' }, refreshToken: 'new-refresh-token', csrfToken: 'new-csrf-token', expiresAt: new Date('2026-10-28T08:00:00.000Z') }),
      logout: async () => true,
      logoutAll: async () => true,
      rotateCsrf: async () => 'new-csrf-token',
    },
    devices: { listForAdministrator: async () => [] },
    deviceManagement: { update: async () => 'updated' as const, revoke: async () => 'revoked' as const },
    testAuthorizations: {
      get: async () => ({ authorization: null, candidates: [] }),
      grant: async () => 'granted' as const,
      getActiveForDevice: async () => null,
    },
    pairing: { create: async () => { throw new Error('不应调用'); } },
    enrollment: { enroll: async () => ({ status: 'invalid_token' as const }) },
    deviceAuth: { createChallenge: () => ({ nonce: 'x'.repeat(43), expiresAt: new Date(Date.now() + 15_000) }), authenticate: async () => ({ status: 'invalid_signature' as const }), recordHeartbeat: async () => true },
  };
}
