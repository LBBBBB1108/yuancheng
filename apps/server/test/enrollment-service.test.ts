import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  EnrollmentService,
  type EnrollmentRepository,
  type EnrollmentTransaction,
} from '../src/enrollment/enrollment-service.js';

class RecordingRepository implements EnrollmentRepository {
  public transaction: EnrollmentTransaction | undefined;
  public result: Awaited<ReturnType<EnrollmentRepository['enroll']>> = {
    status: 'registered',
    deviceId: 'de24faa0-fbcd-4f0a-a6e9-fbbfe8aadf1a',
  };

  async enroll(transaction: EnrollmentTransaction) {
    this.transaction = transaction;
    return this.result;
  }
}

describe('EnrollmentService', () => {
  it('hashes a single-use token before passing it to the repository', async () => {
    const repository = new RecordingRepository();
    const service = new EnrollmentService(repository);
    const token = 'test_pairing_token_1234567890';

    const result = await service.enroll({
      token,
      deviceName: '财务测试机',
      publicKey: Buffer.alloc(32, 7).toString('base64'),
      osVersion: 'Windows 11 23H2',
      clientVersion: '0.1.0-test',
      now: new Date('2026-10-21T08:00:00.000Z'),
    });

    expect(result.status).toBe('registered');
    expect(repository.transaction?.tokenHash).toBe(
      createHash('sha256').update(token).digest('hex'),
    );
    expect(repository.transaction).not.toHaveProperty('token');
    expect(repository.transaction?.maximumActiveDevices).toBe(5);
  });

  it('rejects malformed Ed25519 public keys without calling the repository', async () => {
    const repository = new RecordingRepository();
    const service = new EnrollmentService(repository);

    await expect(
      service.enroll({
        token: 'test_pairing_token_1234567890',
        deviceName: '测试机',
        publicKey: Buffer.alloc(31).toString('base64'),
        osVersion: 'Windows 11',
        clientVersion: '0.1.0-test',
        now: new Date(),
      }),
    ).rejects.toThrow('设备公钥格式无效');
    expect(repository.transaction).toBeUndefined();
  });
});
