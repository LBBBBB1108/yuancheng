import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { PROTOCOL_VERSION, parseJsonMessage } from '@yuancheng/protocol';

import type { AppConfig } from './config.js';
import type { LoginRequest, LoginResult } from './auth/admin-auth-service.js';
import type {
  EnrollmentRequest,
  EnrollmentResult,
} from './enrollment/enrollment-service.js';
import type { PairingDescriptor } from './enrollment/pairing-service.js';
import type {
  DeviceAuthResponse,
  DeviceAuthResult,
} from './devices/device-auth-service.js';

export interface AuthenticatedAdministrator {
  id: string;
  permissions: string[];
}

export interface DeviceSummary {
  id: string;
  name: string;
  groupName: string | null;
  osVersion: string;
  clientVersion: string;
  online: boolean;
  lastSeenAt: string | null;
}

export interface AppServices {
  adminAuth: {
    login(request: LoginRequest): Promise<LoginResult | null>;
    authenticate(token: string, now: Date): Promise<AuthenticatedAdministrator | null>;
    authenticateMutation(
      token: string,
      csrfToken: string,
      now: Date,
    ): Promise<AuthenticatedAdministrator | null>;
    getSession(token: string, now: Date): Promise<{ admin: { id: string; displayName: string }; permissions: string[]; expiresAt: Date } | null>;
    refresh(token: string, csrfToken: string, now: Date, userAgent: string | null, ipAddress: string | null): Promise<LoginResult | null>;
    logout(token: string, csrfToken: string, now: Date): Promise<boolean>;
    logoutAll(token: string, csrfToken: string, now: Date): Promise<boolean>;
    rotateCsrf(token: string, now: Date): Promise<string | null>;
  };
  devices: {
    listForAdministrator(administratorId: string): Promise<DeviceSummary[]>;
  };
  deviceManagement: {
    update(request: { administratorId: string; deviceId: string; name: string; groupName: string | null; now: Date }): Promise<'updated' | 'invalid' | 'not_found'>;
    revoke(request: { administratorId: string; deviceId: string; now: Date }): Promise<'revoked' | 'not_found'>;
  };
  testAuthorizations: {
    get(request: { actorAdministratorId: string; deviceId: string; now: Date }): Promise<{
      authorization: { administratorId: string; displayName: string; validUntil: Date } | null;
      candidates: Array<{ id: string; displayName: string }>;
    } | null>;
    grant(request: { actorAdministratorId: string; deviceId: string; designatedAdministratorId: string; now: Date }): Promise<'granted' | 'not_found'>;
    getActiveForDevice(deviceId: string, now: Date): Promise<{ administratorId: string; validUntil: Date } | null>;
  };
  pairing: {
    create(request: {
      requestedDeviceName: string;
      administratorId: string;
      now: Date;
    }): Promise<{ enrollment: PairingDescriptor; expiresAt: Date }>;
  };
  enrollment: {
    enroll(request: EnrollmentRequest): Promise<EnrollmentResult>;
  };
  deviceAuth: {
    createChallenge(now: Date): { nonce: string; expiresAt: Date };
    authenticate(request: DeviceAuthResponse, now: Date): Promise<DeviceAuthResult>;
    recordHeartbeat(deviceId: string, seenAt: Date): Promise<boolean>;
  };
}

export async function buildApp(
  config: AppConfig,
  services?: AppServices,
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.nodeEnv !== 'test',
    bodyLimit: 1024 * 1024,
    requestTimeout: 15_000,
    trustProxy: false,
  });

  await app.register(cors, {
    origin: config.adminWebOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  await app.register(cookie, { secret: config.sessionSecret });
  await app.register(websocket, {
    options: {
      maxPayload: 2 * 1024 * 1024,
      perMessageDeflate: false,
    },
  });

  app.get('/health', async () => ({
    status: 'ok',
    mode: config.deploymentMode,
    database: 'not_checked',
  }));

  if (services) {
    app.get('/ws/device', { websocket: true }, (socket) => {
      let authenticatedDeviceId: string | null = null;
      const challenge = services.deviceAuth.createChallenge(new Date());
      const authTimeout = setTimeout(() => {
        sendProtocolError(socket, 'AUTH_TIMEOUT', '设备身份认证超时', true);
      }, Math.max(1, challenge.expiresAt.getTime() - Date.now()));
      authTimeout.unref();

      socket.send(
        JSON.stringify({
          protocolVersion: PROTOCOL_VERSION,
          type: 'device.auth.challenge',
          nonce: challenge.nonce,
          expiresAt: challenge.expiresAt.toISOString(),
        }),
      );

      socket.on('message', (data: Buffer, isBinary: boolean) => {
        void (async () => {
          if (isBinary) {
            sendProtocolError(socket, 'INVALID_MESSAGE', '身份认证阶段不接受二进制消息', true);
            return;
          }

          const parsed = parseSocketMessage(data.toString());
          if (!parsed.ok) {
            sendProtocolError(socket, 'INVALID_MESSAGE', parsed.error, true);
            return;
          }

          if (!authenticatedDeviceId) {
            if (parsed.message.type !== 'device.auth.response') {
              sendProtocolError(socket, 'AUTH_REQUIRED', '设备尚未通过身份认证', true);
              return;
            }

            const result = await services.deviceAuth.authenticate(parsed.message, new Date());
            if (result.status !== 'authenticated') {
              sendProtocolError(socket, 'AUTH_FAILED', authFailureMessage(result.status), true);
              return;
            }

            clearTimeout(authTimeout);
            authenticatedDeviceId = result.deviceId;
            const testAuthorization = await services.testAuthorizations.getActiveForDevice(result.deviceId, new Date());
            socket.send(
              JSON.stringify({
                protocolVersion: PROTOCOL_VERSION,
                type: 'device.authenticated',
                deviceId: result.deviceId,
                heartbeatIntervalSeconds: 20,
                testAuthorization: serializeTestAuthorization(testAuthorization),
              }),
            );
            return;
          }

          if (parsed.message.type !== 'device.heartbeat') {
            sendProtocolError(socket, 'MESSAGE_NOT_ALLOWED', '当前连接不允许此消息类型', false);
            return;
          }

          const stillActive = await services.deviceAuth.recordHeartbeat(
            authenticatedDeviceId,
            new Date(),
          );
          if (!stillActive) {
            socket.send(
              JSON.stringify({
                protocolVersion: PROTOCOL_VERSION,
                type: 'device.revoked',
                reason: '设备登记已被撤销',
              }),
              () => socket.close(1008),
            );
            return;
          }

          socket.send(
            JSON.stringify({
              protocolVersion: PROTOCOL_VERSION,
              type: 'device.heartbeat.ack',
              receivedAt: new Date().toISOString(),
              testAuthorization: serializeTestAuthorization(
                await services.testAuthorizations.getActiveForDevice(authenticatedDeviceId, new Date()),
              ),
            }),
          );
        })().catch(() => {
          sendProtocolError(socket, 'SERVER_ERROR', '设备连接处理失败', true);
        });
      });

      socket.once('close', () => clearTimeout(authTimeout));
    });

    app.post<{ Body: { username?: unknown; password?: unknown } }>(
      '/api/v1/auth/login',
      async (request, reply) => {
        const { username, password } = request.body ?? {};
        if (typeof username !== 'string' || typeof password !== 'string') {
          return reply.status(400).send({ error: '用户名和密码格式无效' });
        }

        const result = await services.adminAuth.login({
          username,
          password,
          now: new Date(),
          userAgent: request.headers['user-agent'] ?? null,
          ipAddress: request.ip,
        });
        if (!result) {
          return reply.status(401).send({ error: '用户名或密码错误' });
        }

        reply.setCookie('yc_session', result.refreshToken, {
          path: '/api/v1',
          httpOnly: true,
          secure: config.nodeEnv === 'production',
          sameSite: config.nodeEnv === 'production' ? 'none' : 'lax',
          expires: result.expiresAt,
        });
        return reply.send({
          admin: result.admin,
          csrfToken: result.csrfToken,
          expiresAt: result.expiresAt.toISOString(),
        });
      },
    );

    app.get('/api/v1/auth/session', async (request, reply) => {
      if (!isTrustedOrigin(request.headers.origin, config.adminWebOrigin)) {
        return reply.status(403).send({ error: '请求来源无效' });
      }
      const token = request.cookies.yc_session;
      const session = token ? await services.adminAuth.getSession(token, new Date()) : null;
      if (!session) return reply.status(401).send({ error: '登录已失效' });
      return reply.send({ ...session, expiresAt: session.expiresAt.toISOString() });
    });

    app.get('/api/v1/auth/csrf', async (request, reply) => {
      if (!isTrustedOrigin(request.headers.origin, config.adminWebOrigin)) {
        return reply.status(403).send({ error: '请求来源无效' });
      }
      const token = request.cookies.yc_session;
      const csrfToken = token ? await services.adminAuth.rotateCsrf(token, new Date()) : null;
      if (!csrfToken) return reply.status(401).send({ error: '登录已失效' });
      reply.header('cache-control', 'no-store');
      return reply.send({ csrfToken });
    });

    app.post('/api/v1/auth/refresh', async (request, reply) => {
      const token = request.cookies.yc_session;
      const csrfToken = request.headers['x-csrf-token'];
      if (!isTrustedOrigin(request.headers.origin, config.adminWebOrigin) || !token || typeof csrfToken !== 'string') {
        return reply.status(403).send({ error: '登录或请求校验已失效' });
      }
      const result = await services.adminAuth.refresh(token, csrfToken, new Date(), request.headers['user-agent'] ?? null, request.ip);
      if (!result) return reply.status(401).send({ error: '登录或请求校验已失效' });
      setSessionCookie(reply, result.refreshToken, result.expiresAt, config);
      return reply.send({ admin: result.admin, csrfToken: result.csrfToken, expiresAt: result.expiresAt.toISOString() });
    });

    app.post('/api/v1/auth/logout', async (request, reply) => {
      const token = request.cookies.yc_session;
      const csrfToken = request.headers['x-csrf-token'];
      if (!isTrustedOrigin(request.headers.origin, config.adminWebOrigin) || !token || typeof csrfToken !== 'string' || !await services.adminAuth.logout(token, csrfToken, new Date())) {
        return reply.status(403).send({ error: '登录或请求校验已失效' });
      }
      reply.clearCookie('yc_session', { path: '/api/v1' });
      return reply.status(204).send();
    });

    app.post('/api/v1/auth/logout-all', async (request, reply) => {
      const token = request.cookies.yc_session;
      const csrfToken = request.headers['x-csrf-token'];
      if (!isTrustedOrigin(request.headers.origin, config.adminWebOrigin) || !token || typeof csrfToken !== 'string' || !await services.adminAuth.logoutAll(token, csrfToken, new Date())) {
        return reply.status(403).send({ error: '登录或请求校验已失效' });
      }
      reply.clearCookie('yc_session', { path: '/api/v1' });
      return reply.status(204).send();
    });

    app.get('/api/v1/devices', async (request, reply) => {
      const token = request.cookies.yc_session;
      if (!token) return reply.status(401).send({ error: '请先登录' });
      const administrator = await services.adminAuth.authenticate(token, new Date());
      if (!administrator) return reply.status(401).send({ error: '登录已失效' });
      if (!administrator.permissions.includes('devices.read')) {
        return reply.status(403).send({ error: '没有设备读取权限' });
      }

      const devices = await services.devices.listForAdministrator(administrator.id);
      return reply.send({ devices });
    });

    app.patch<{ Params: { deviceId?: string }; Body: Record<string, unknown> }>(
      '/api/v1/devices/:deviceId',
      async (request, reply) => {
        const token = request.cookies.yc_session;
        const csrfToken = request.headers['x-csrf-token'];
        const body = request.body ?? {};
        if (!isTrustedOrigin(request.headers.origin, config.adminWebOrigin) || !token || typeof csrfToken !== 'string') {
          return reply.status(403).send({ error: '登录或请求校验已失效' });
        }
        const administrator = await services.adminAuth.authenticateMutation(token, csrfToken, new Date());
        if (!administrator) return reply.status(401).send({ error: '登录或请求校验已失效' });
        if (!administrator.permissions.includes('devices.manage')) return reply.status(403).send({ error: '没有设备管理权限' });
        if (!isUuid(request.params.deviceId) || !hasOnlyKeys(body, ['name', 'groupName']) || typeof body.name !== 'string' || (typeof body.groupName !== 'string' && body.groupName !== null)) {
          return reply.status(400).send({ error: '设备管理请求格式无效' });
        }
        const result = await services.deviceManagement.update({
          administratorId: administrator.id, deviceId: request.params.deviceId, name: body.name,
          groupName: body.groupName as string | null, now: new Date(),
        });
        if (result === 'invalid') return reply.status(400).send({ error: '设备名称或分组格式无效' });
        if (result === 'not_found') return reply.status(404).send({ error: '设备不存在、已撤销或未授权' });
        return reply.status(204).send();
      },
    );

    app.delete<{ Params: { deviceId?: string } }>('/api/v1/devices/:deviceId', async (request, reply) => {
      const token = request.cookies.yc_session;
      const csrfToken = request.headers['x-csrf-token'];
      if (!isTrustedOrigin(request.headers.origin, config.adminWebOrigin) || !token || typeof csrfToken !== 'string') {
        return reply.status(403).send({ error: '登录或请求校验已失效' });
      }
      const administrator = await services.adminAuth.authenticateMutation(token, csrfToken, new Date());
      if (!administrator) return reply.status(401).send({ error: '登录或请求校验已失效' });
      if (!administrator.permissions.includes('devices.manage')) return reply.status(403).send({ error: '没有设备管理权限' });
      if (!isUuid(request.params.deviceId)) return reply.status(400).send({ error: '设备管理请求格式无效' });
      const result = await services.deviceManagement.revoke({ administratorId: administrator.id, deviceId: request.params.deviceId, now: new Date() });
      if (result === 'not_found') return reply.status(404).send({ error: '设备不存在、已撤销或未授权' });
      return reply.status(204).send();
    });

    app.get<{ Params: { deviceId?: string } }>('/api/v1/devices/:deviceId/test-authorization', async (request, reply) => {
      const token = request.cookies.yc_session;
      if (!isTrustedOrigin(request.headers.origin, config.adminWebOrigin) || !token) return reply.status(403).send({ error: '登录或请求校验已失效' });
      const administrator = await services.adminAuth.authenticate(token, new Date());
      if (!administrator) return reply.status(401).send({ error: '登录已失效' });
      if (!administrator.permissions.includes('devices.manage')) return reply.status(403).send({ error: '没有设备管理权限' });
      if (!isUuid(request.params.deviceId)) return reply.status(400).send({ error: '测试授权请求格式无效' });
      const result = await services.testAuthorizations.get({ actorAdministratorId: administrator.id, deviceId: request.params.deviceId, now: new Date() });
      if (!result) return reply.status(404).send({ error: '设备不存在、已撤销或未授权' });
      return reply.send({ authorization: result.authorization && { ...result.authorization, validUntil: result.authorization.validUntil.toISOString() }, candidates: result.candidates });
    });

    app.post<{ Params: { deviceId?: string }; Body: Record<string, unknown> }>('/api/v1/devices/:deviceId/test-authorization', async (request, reply) => {
      const token = request.cookies.yc_session;
      const csrfToken = request.headers['x-csrf-token'];
      const body = request.body ?? {};
      if (!isTrustedOrigin(request.headers.origin, config.adminWebOrigin) || !token || typeof csrfToken !== 'string') return reply.status(403).send({ error: '登录或请求校验已失效' });
      const administrator = await services.adminAuth.authenticateMutation(token, csrfToken, new Date());
      if (!administrator) return reply.status(401).send({ error: '登录或请求校验已失效' });
      if (!administrator.permissions.includes('devices.manage')) return reply.status(403).send({ error: '没有设备管理权限' });
      if (!isUuid(request.params.deviceId) || !hasOnlyKeys(body, ['administratorId']) || !isUuid(body.administratorId)) return reply.status(400).send({ error: '测试授权请求格式无效' });
      const result = await services.testAuthorizations.grant({ actorAdministratorId: administrator.id, deviceId: request.params.deviceId, designatedAdministratorId: body.administratorId, now: new Date() });
      if (result === 'not_found') return reply.status(404).send({ error: '设备、指定管理员不存在或未授权' });
      return reply.status(200).send();
    });

    app.post<{ Body: { requestedDeviceName?: unknown } }>(
      '/api/v1/pairing-packages',
      async (request, reply) => {
        const token = request.cookies.yc_session;
        const csrfToken = request.headers['x-csrf-token'];
        if (!token || typeof csrfToken !== 'string') {
          return reply.status(401).send({ error: '登录或请求校验已失效' });
        }
        const administrator = await services.adminAuth.authenticateMutation(
          token,
          csrfToken,
          new Date(),
        );
        if (!administrator) {
          return reply.status(401).send({ error: '登录或请求校验已失效' });
        }
        if (!administrator.permissions.includes('devices.manage')) {
          return reply.status(403).send({ error: '没有设备管理权限' });
        }
        if (typeof request.body?.requestedDeviceName !== 'string') {
          return reply.status(400).send({ error: '设备名称格式无效' });
        }

        const result = await services.pairing.create({
          requestedDeviceName: request.body.requestedDeviceName,
          administratorId: administrator.id,
          now: new Date(),
        });
        return reply.status(201).send({
          enrollment: result.enrollment,
          expiresAt: result.expiresAt.toISOString(),
        });
      },
    );

    app.post<{ Body: Record<string, unknown> }>(
      '/api/v1/devices/enroll',
      async (request, reply) => {
        const body = request.body ?? {};
        const allowedKeys = ['token', 'deviceName', 'publicKey', 'osVersion', 'clientVersion'];
        if (
          !hasOnlyKeys(body, allowedKeys) ||
          allowedKeys.some((key) => typeof body[key] !== 'string')
        ) {
          return reply.status(400).send({ error: '登记请求格式无效' });
        }

        const result = await services.enrollment.enroll({
          token: body.token as string,
          deviceName: body.deviceName as string,
          publicKey: body.publicKey as string,
          osVersion: body.osVersion as string,
          clientVersion: body.clientVersion as string,
          now: new Date(),
        });
        if (result.status === 'registered') {
          return reply.status(201).send({ deviceId: result.deviceId });
        }
        if (result.status === 'device_limit_reached') {
          return reply.status(409).send({ error: '测试环境最多登记 5 台有效设备' });
        }
        return reply.status(401).send({
          error: result.status === 'expired_token' ? '登记令牌已过期' : '登记令牌无效',
        });
      },
    );
  }

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    const statusCode = getStatusCode(error);
    void reply.status(statusCode).send({
      error: statusCode < 500 && error instanceof Error ? error.message : '服务器内部错误',
    });
  });

  return app;
}

function parseSocketMessage(input: string) {
  try {
    return parseJsonMessage(JSON.parse(input) as unknown);
  } catch {
    return { ok: false as const, error: '消息格式无效' as const };
  }
}

function sendProtocolError(
  socket: { send(data: string, callback?: (error?: Error) => void): void; close(code?: number): void },
  code: string,
  message: string,
  closeAfterSend: boolean,
): void {
  socket.send(
    JSON.stringify({ protocolVersion: PROTOCOL_VERSION, type: 'protocol.error', code, message }),
    () => {
      if (closeAfterSend) socket.close(1008);
    },
  );
}

function authFailureMessage(status: Exclude<DeviceAuthResult['status'], 'authenticated'>): string {
  switch (status) {
    case 'expired_challenge':
      return '设备身份认证挑战已过期';
    case 'device_not_found':
      return '设备未登记或已被撤销';
    case 'invalid_challenge':
    case 'invalid_signature':
      return '设备身份凭证无效';
  }
}

function serializeTestAuthorization(authorization: { administratorId: string; validUntil: Date } | null) {
  return authorization && { administratorId: authorization.administratorId, validUntil: authorization.validUntil.toISOString() };
}

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === allowedKeys.length && keys.every((key) => allowedKeys.includes(key));
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function getStatusCode(error: unknown): number {
  if (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    typeof error.statusCode === 'number'
  ) {
    return error.statusCode;
  }
  return 500;
}

function isTrustedOrigin(origin: string | undefined, expectedOrigin: string): boolean {
  return origin === expectedOrigin;
}

function setSessionCookie(
  reply: { setCookie(name: string, value: string, options: Record<string, unknown>): unknown },
  refreshToken: string,
  expiresAt: Date,
  config: AppConfig,
): void {
  reply.setCookie('yc_session', refreshToken, {
    path: '/api/v1', httpOnly: true, secure: config.nodeEnv === 'production',
    sameSite: config.nodeEnv === 'production' ? 'none' : 'lax', expires: expiresAt,
  });
}
