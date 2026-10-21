import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';

import type { AppConfig } from './config.js';
import type { LoginRequest, LoginResult } from './auth/admin-auth-service.js';
import type {
  EnrollmentRequest,
  EnrollmentResult,
} from './enrollment/enrollment-service.js';
import type { PairingDescriptor } from './enrollment/pairing-service.js';

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
  };
  devices: {
    listForAdministrator(administratorId: string): Promise<DeviceSummary[]>;
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

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === allowedKeys.length && keys.every((key) => allowedKeys.includes(key));
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
