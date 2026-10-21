import { createHash } from 'node:crypto';

import argon2 from 'argon2';
import { describe, expect, it } from 'vitest';

import {
  AdminAuthService,
  type AdminAuthRepository,
  type StoredAdmin,
  type StoredAdminSession,
} from '../src/auth/admin-auth-service.js';

class MemoryAuthRepository implements AdminAuthRepository {
  public createdSession: StoredAdminSession | undefined;

  public constructor(private readonly admin: StoredAdmin | null) {}

  async findActiveByUsername(): Promise<StoredAdmin | null> {
    return this.admin;
  }

  async createSession(session: StoredAdminSession): Promise<void> {
    this.createdSession = session;
  }

  async findSessionByRefreshTokenHash(tokenHash: string, now: Date) {
    if (
      !this.createdSession ||
      this.createdSession.refreshTokenHash !== tokenHash ||
      this.createdSession.expiresAt <= now
    ) {
      return null;
    }
    return {
      id: this.createdSession.administratorId,
      permissions: ['devices.read'],
      csrfTokenHash: this.createdSession.csrfTokenHash,
    };
  }
}

describe('AdminAuthService', () => {
  it('verifies Argon2id passwords and stores only token hashes', async () => {
    const repository = new MemoryAuthRepository({
      id: '8cf836c8-2e28-4dd9-84ab-61a167774a3d',
      displayName: '测试管理员',
      passwordHash: await argon2.hash('correct horse battery staple', {
        type: argon2.argon2id,
      }),
    });
    const service = new AdminAuthService(repository);

    const result = await service.login({
      username: 'admin',
      password: 'correct horse battery staple',
      now: new Date('2026-10-21T08:00:00.000Z'),
      userAgent: 'vitest',
      ipAddress: '127.0.0.1',
    });

    expect(result?.admin.displayName).toBe('测试管理员');
    expect(result?.refreshToken).toHaveLength(43);
    expect(repository.createdSession?.refreshTokenHash).toBe(
      createHash('sha256').update(result?.refreshToken ?? '').digest('hex'),
    );
    expect(JSON.stringify(repository.createdSession)).not.toContain(result?.refreshToken);

    const authenticated = await service.authenticate(
      result?.refreshToken ?? '',
      new Date('2026-10-21T08:01:00.000Z'),
    );
    expect(authenticated).toEqual({
      id: '8cf836c8-2e28-4dd9-84ab-61a167774a3d',
      permissions: ['devices.read'],
    });

    await expect(
      service.authenticateMutation(
        result?.refreshToken ?? '',
        result?.csrfToken ?? '',
        new Date('2026-10-21T08:01:00.000Z'),
      ),
    ).resolves.toEqual(authenticated);
    await expect(
      service.authenticateMutation(
        result?.refreshToken ?? '',
        'wrong-csrf-token',
        new Date('2026-10-21T08:01:00.000Z'),
      ),
    ).resolves.toBeNull();
  });

  it('returns null for an invalid password without creating a session', async () => {
    const repository = new MemoryAuthRepository({
      id: '8cf836c8-2e28-4dd9-84ab-61a167774a3d',
      displayName: '测试管理员',
      passwordHash: await argon2.hash('right-password', { type: argon2.argon2id }),
    });
    const service = new AdminAuthService(repository);

    const result = await service.login({
      username: 'admin',
      password: 'wrong-password',
      now: new Date(),
      userAgent: 'vitest',
      ipAddress: '127.0.0.1',
    });

    expect(result).toBeNull();
    expect(repository.createdSession).toBeUndefined();
  });
});
