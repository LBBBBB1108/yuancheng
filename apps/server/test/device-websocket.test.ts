import { describe, expect, it } from 'vitest';

import { buildApp, type AppServices } from '../src/app.js';

const config = {
  host: '127.0.0.1',
  port: 10000,
  databaseUrl: 'postgresql://unused',
  adminWebOrigin: 'http://localhost:5173',
  sessionSecret: '0123456789abcdef0123456789abcdef',
  publicServerUrl: 'http://localhost:10000',
  deploymentMode: 'test' as const,
  nodeEnv: 'test',
};

const challenge = {
  nonce: 'a'.repeat(43),
  expiresAt: new Date('2026-10-22T08:00:15.000Z'),
};
const deviceId = '19d7b60c-f258-4be3-8e5a-698670687843';

function createServices(
  authenticate: AppServices['deviceAuth']['authenticate'],
  recordHeartbeat: AppServices['deviceAuth']['recordHeartbeat'] = async () => true,
): AppServices {
  return {
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
    enrollment: { enroll: async () => ({ status: 'invalid_token' }) },
    deviceAuth: {
      createChallenge: () => challenge,
      authenticate,
      recordHeartbeat,
    },
  };
}

function nextMessage(socket: { once(event: string, listener: (...args: any[]) => void): void }) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('等待 WebSocket 消息超时')), 2_000);
    socket.once('message', (data: Buffer) => {
      clearTimeout(timeout);
      resolve(JSON.parse(data.toString()) as Record<string, unknown>);
    });
  });
}

async function connectWithFirstMessage(app: Awaited<ReturnType<typeof buildApp>>) {
  await app.ready();
  let firstMessage!: Promise<Record<string, unknown>>;
  const socket = await app.injectWS('/ws/device', {}, {
    onInit: (initializingSocket) => {
      firstMessage = nextMessage(initializingSocket);
    },
  });
  return { socket, firstMessage };
}

describe('device WebSocket', () => {
  it('requires a signed challenge before accepting heartbeats', async () => {
    const requests: unknown[] = [];
    const heartbeats: unknown[] = [];
    const app = await buildApp(
      config,
      createServices(async (request) => {
        requests.push(request);
        return { status: 'authenticated', deviceId };
      }, async (id, seenAt) => {
        heartbeats.push({ id, seenAt });
        return true;
      }),
    );
    const { socket, firstMessage } = await connectWithFirstMessage(app);

    expect(await firstMessage).toEqual({
      protocolVersion: 1,
      type: 'device.auth.challenge',
      nonce: challenge.nonce,
      expiresAt: challenge.expiresAt.toISOString(),
    });

    socket.send(
      JSON.stringify({
        protocolVersion: 1,
        type: 'device.auth.response',
        deviceId,
        nonce: challenge.nonce,
        signature: 'b'.repeat(88),
        clientVersion: '0.1.0-test',
        osVersion: 'Windows 11',
      }),
    );
    expect(await nextMessage(socket)).toEqual({
      protocolVersion: 1,
      type: 'device.authenticated',
      deviceId,
      heartbeatIntervalSeconds: 20,
    });
    expect(requests).toHaveLength(1);

    socket.send(
      JSON.stringify({
        protocolVersion: 1,
        type: 'device.heartbeat',
        sentAt: '2026-10-22T08:00:20.000Z',
      }),
    );
    const heartbeatAck = await nextMessage(socket);
    expect(heartbeatAck.type).toBe('device.heartbeat.ack');
    expect(typeof heartbeatAck.receivedAt).toBe('string');
    expect(heartbeats).toHaveLength(1);

    socket.close();
    await app.close();
  });

  it('notifies and disconnects a device revoked after authentication', async () => {
    const app = await buildApp(
      config,
      createServices(
        async () => ({ status: 'authenticated', deviceId }),
        async () => false,
      ),
    );
    const { socket, firstMessage } = await connectWithFirstMessage(app);
    await firstMessage;
    socket.send(
      JSON.stringify({
        protocolVersion: 1,
        type: 'device.auth.response',
        deviceId,
        nonce: challenge.nonce,
        signature: 'b'.repeat(88),
        clientVersion: '0.1.0-test',
        osVersion: 'Windows 11',
      }),
    );
    await nextMessage(socket);
    socket.send(
      JSON.stringify({
        protocolVersion: 1,
        type: 'device.heartbeat',
        sentAt: '2026-10-22T08:00:20.000Z',
      }),
    );

    expect(await nextMessage(socket)).toEqual({
      protocolVersion: 1,
      type: 'device.revoked',
      reason: '设备登记已被撤销',
    });
    await new Promise<void>((resolve) => socket.once('close', () => resolve()));
    await app.close();
  });

  it('rejects a non-authentication message before authentication', async () => {
    const app = await buildApp(
      config,
      createServices(async () => ({ status: 'invalid_signature' })),
    );
    const { socket, firstMessage } = await connectWithFirstMessage(app);
    await firstMessage;

    socket.send(
      JSON.stringify({
        protocolVersion: 1,
        type: 'device.heartbeat',
        sentAt: '2026-10-22T08:00:00.000Z',
      }),
    );

    expect(await nextMessage(socket)).toEqual({
      protocolVersion: 1,
      type: 'protocol.error',
      code: 'AUTH_REQUIRED',
      message: '设备尚未通过身份认证',
    });
    await new Promise<void>((resolve) => socket.once('close', () => resolve()));
    await app.close();
  });
});
