import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  PairingService,
  type PairingRepository,
  type StoredPairingToken,
} from '../src/enrollment/pairing-service.js';

class MemoryPairingRepository implements PairingRepository {
  public stored: StoredPairingToken | undefined;

  async create(token: StoredPairingToken): Promise<void> {
    this.stored = token;
  }
}

describe('PairingService', () => {
  it('creates a 30-minute single-device enrollment descriptor and stores only its hash', async () => {
    const repository = new MemoryPairingRepository();
    const service = new PairingService(repository, 'https://api.example.com');

    const result = await service.create({
      requestedDeviceName: '财务测试机',
      administratorId: 'admin-id',
      now: new Date('2026-10-21T08:00:00.000Z'),
    });

    expect(result.enrollment.token).toHaveLength(43);
    expect(result.enrollment.serverUrl).toBe('https://api.example.com');
    expect(result.expiresAt.toISOString()).toBe('2026-10-21T08:30:00.000Z');
    expect(repository.stored?.tokenHash).toBe(
      createHash('sha256').update(result.enrollment.token).digest('hex'),
    );
    expect(JSON.stringify(repository.stored)).not.toContain(result.enrollment.token);
  });
});
