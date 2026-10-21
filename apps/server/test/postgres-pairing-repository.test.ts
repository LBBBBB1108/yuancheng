import { describe, expect, it } from 'vitest';

import { PostgresPairingRepository } from '../src/enrollment/postgres-pairing-repository.js';

class FakeClient {
  public readonly statements: string[] = [];
  public released = false;

  async query(text: string): Promise<{ rows: [] }> {
    this.statements.push(text.replace(/\s+/g, ' ').trim());
    return { rows: [] };
  }

  release(): void {
    this.released = true;
  }
}

describe('PostgresPairingRepository', () => {
  it('stores the pairing hash and audit event atomically', async () => {
    const client = new FakeClient();
    const repository = new PostgresPairingRepository({ connect: async () => client });

    await repository.create({
      id: 'token-id',
      tokenHash: 'a'.repeat(64),
      requestedDeviceName: '测试机',
      createdBy: 'admin-id',
      createdAt: new Date('2026-10-21T08:00:00.000Z'),
      expiresAt: new Date('2026-10-21T08:30:00.000Z'),
    });

    expect(client.statements.some((sql) => sql.startsWith('INSERT INTO pairing_tokens'))).toBe(true);
    expect(client.statements.some((sql) => sql.startsWith('INSERT INTO audit_events'))).toBe(true);
    expect(client.statements.at(-1)).toBe('COMMIT');
    expect(client.released).toBe(true);
  });
});
