import { describe, expect, it } from 'vitest';

import { PostgresEnrollmentRepository } from '../src/enrollment/postgres-enrollment-repository.js';
import type { EnrollmentTransaction } from '../src/enrollment/enrollment-service.js';

type QueryResult = { rows: Array<Record<string, unknown>> };

class FakeClient {
  public readonly statements: string[] = [];
  public released = false;

  public constructor(private readonly results: QueryResult[]) {}

  async query(text: string): Promise<QueryResult> {
    this.statements.push(text.replace(/\s+/g, ' ').trim());
    return this.results.shift() ?? { rows: [] };
  }

  release(): void {
    this.released = true;
  }
}

const transaction: EnrollmentTransaction = {
  tokenHash: 'a'.repeat(64),
  deviceName: '测试电脑',
  publicKey: Buffer.alloc(32, 2).toString('base64'),
  osVersion: 'Windows 11',
  clientVersion: '0.1.0-test',
  now: new Date('2026-10-21T08:00:00.000Z'),
  maximumActiveDevices: 5,
};

describe('PostgresEnrollmentRepository', () => {
  it('serializes enrollment and rejects the sixth active device', async () => {
    const client = new FakeClient([
      { rows: [] },
      { rows: [] },
      { rows: [{ id: 'token-id', expires_at: '2026-10-21T08:30:00.000Z' }] },
      { rows: [{ count: '5' }] },
      { rows: [] },
    ]);
    const repository = new PostgresEnrollmentRepository({
      connect: async () => client,
    });

    const result = await repository.enroll(transaction);

    expect(result).toEqual({ status: 'device_limit_reached' });
    expect(client.statements.some((sql) => sql.includes('pg_advisory_xact_lock'))).toBe(true);
    expect(client.statements.some((sql) => sql.startsWith('INSERT INTO devices'))).toBe(false);
    expect(client.statements.at(-1)).toBe('COMMIT');
    expect(client.released).toBe(true);
  });

  it('consumes the token and creates a device in the same transaction', async () => {
    const client = new FakeClient([
      { rows: [] },
      { rows: [] },
      { rows: [{ id: 'token-id', expires_at: '2026-10-21T08:30:00.000Z' }] },
      { rows: [{ count: '4' }] },
      { rows: [{ id: 'de24faa0-fbcd-4f0a-a6e9-fbbfe8aadf1a' }] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
    ]);
    const repository = new PostgresEnrollmentRepository({
      connect: async () => client,
    });

    const result = await repository.enroll(transaction);

    expect(result).toEqual({
      status: 'registered',
      deviceId: 'de24faa0-fbcd-4f0a-a6e9-fbbfe8aadf1a',
    });
    expect(client.statements.some((sql) => sql.startsWith('INSERT INTO admin_device_grants'))).toBe(true);
    expect(client.statements.some((sql) => sql.startsWith('UPDATE pairing_tokens'))).toBe(true);
    expect(client.statements.some((sql) => sql.startsWith('INSERT INTO audit_events'))).toBe(true);
    expect(client.statements.at(-1)).toBe('COMMIT');
  });
});
