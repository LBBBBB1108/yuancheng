import { Type, type Static, type TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

export const PROTOCOL_VERSION = 1 as const;

const baseProperties = {
  protocolVersion: Type.Literal(PROTOCOL_VERSION),
};

export const DeviceHeartbeatSchema = Type.Object(
  {
    ...baseProperties,
    type: Type.Literal('device.heartbeat'),
    sentAt: Type.String({ minLength: 20, maxLength: 35 }),
  },
  { additionalProperties: false },
);

export const DeviceAuthResponseSchema = Type.Object(
  {
    ...baseProperties,
    type: Type.Literal('device.auth.response'),
    deviceId: Type.String({ format: 'uuid' }),
    nonce: Type.String({ minLength: 32, maxLength: 256 }),
    signature: Type.String({ minLength: 64, maxLength: 256 }),
    clientVersion: Type.String({ minLength: 1, maxLength: 40 }),
    osVersion: Type.String({ minLength: 1, maxLength: 120 }),
  },
  { additionalProperties: false },
);

export const DeviceAuthChallengeSchema = Type.Object(
  {
    ...baseProperties,
    type: Type.Literal('device.auth.challenge'),
    nonce: Type.String({ minLength: 32, maxLength: 256 }),
    expiresAt: Type.String({ minLength: 20, maxLength: 35 }),
  },
  { additionalProperties: false },
);

export const DeviceRevokedSchema = Type.Object(
  {
    ...baseProperties,
    type: Type.Literal('device.revoked'),
    reason: Type.String({ minLength: 1, maxLength: 200 }),
  },
  { additionalProperties: false },
);

export const ProtocolErrorSchema = Type.Object(
  {
    ...baseProperties,
    type: Type.Literal('protocol.error'),
    code: Type.String({ minLength: 1, maxLength: 80 }),
    message: Type.String({ minLength: 1, maxLength: 200 }),
  },
  { additionalProperties: false },
);

export const JsonMessageSchema = Type.Union([
  DeviceHeartbeatSchema,
  DeviceAuthResponseSchema,
  DeviceAuthChallengeSchema,
  DeviceRevokedSchema,
  ProtocolErrorSchema,
]);

export type JsonMessage = Static<typeof JsonMessageSchema>;

const schemasByType = new Map<string, TSchema>([
  ['device.heartbeat', DeviceHeartbeatSchema],
  ['device.auth.response', DeviceAuthResponseSchema],
  ['device.auth.challenge', DeviceAuthChallengeSchema],
  ['device.revoked', DeviceRevokedSchema],
  ['protocol.error', ProtocolErrorSchema],
]);

export type ParseResult =
  | { ok: true; message: JsonMessage }
  | { ok: false; error: '不支持的消息类型' | '消息格式无效' };

export function parseJsonMessage(input: unknown): ParseResult {
  if (!isRecord(input) || typeof input.type !== 'string') {
    return { ok: false, error: '消息格式无效' };
  }

  const schema = schemasByType.get(input.type);
  if (!schema) {
    return { ok: false, error: '不支持的消息类型' };
  }

  if (!Value.Check(schema, input)) {
    return { ok: false, error: '消息格式无效' };
  }

  return { ok: true, message: input as JsonMessage };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
