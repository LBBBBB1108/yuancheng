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
});
