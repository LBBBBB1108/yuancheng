import { describe, expect, it } from 'vitest';

import { PROTOCOL_VERSION, parseJsonMessage } from '../src/index.js';

describe('parseJsonMessage', () => {
  it('accepts a valid device heartbeat', () => {
    const result = parseJsonMessage({
      type: 'device.heartbeat',
      protocolVersion: PROTOCOL_VERSION,
      sentAt: '2026-10-21T08:00:00.000Z',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.type).toBe('device.heartbeat');
    }
  });

  it('rejects message types outside the protocol whitelist', () => {
    const result = parseJsonMessage({
      type: 'command.execute',
      protocolVersion: PROTOCOL_VERSION,
      command: 'whoami',
    });

    expect(result).toEqual({
      ok: false,
      error: '不支持的消息类型',
    });
  });

  it('rejects unknown fields and incompatible protocol versions', () => {
    expect(
      parseJsonMessage({
        type: 'device.heartbeat',
        protocolVersion: PROTOCOL_VERSION,
        sentAt: '2026-10-21T08:00:00.000Z',
        unexpected: true,
      }),
    ).toEqual({ ok: false, error: '消息格式无效' });

    expect(
      parseJsonMessage({
        type: 'device.heartbeat',
        protocolVersion: 999,
        sentAt: '2026-10-21T08:00:00.000Z',
      }),
    ).toEqual({ ok: false, error: '消息格式无效' });
  });

  it('accepts the server authentication acknowledgement', () => {
    const result = parseJsonMessage({
      type: 'device.authenticated',
      protocolVersion: PROTOCOL_VERSION,
      deviceId: '19d7b60c-f258-4be3-8e5a-698670687843',
      heartbeatIntervalSeconds: 20,
    });

    expect(result.ok).toBe(true);
  });

  it('accepts a heartbeat acknowledgement without allowing extra fields', () => {
    expect(
      parseJsonMessage({
        type: 'device.heartbeat.ack',
        protocolVersion: PROTOCOL_VERSION,
        receivedAt: '2026-10-22T08:00:00.000Z',
      }).ok,
    ).toBe(true);

    expect(
      parseJsonMessage({
        type: 'device.heartbeat.ack',
        protocolVersion: PROTOCOL_VERSION,
        receivedAt: '2026-10-22T08:00:00.000Z',
        command: 'whoami',
      }),
    ).toEqual({ ok: false, error: '消息格式无效' });
  });
});
