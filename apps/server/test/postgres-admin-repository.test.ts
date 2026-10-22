import { describe, expect, it } from 'vitest';

import { PostgresAdminRepository } from '../src/auth/postgres-admin-repository.js';
import { PostgresDeviceRepository } from '../src/devices/postgres-device-repository.js';

class FakePool {
  public readonly statements: string[] = [];

  public constructor(private readonly results: Array<{ rows: Array<Record<string, unknown>> }>) {}

  async query(text: string): Promise<{ rows: Array<Record<string, unknown>> }> {
    this.statements.push(text.replace(/\s+/g, ' ').trim());
    return this.results.shift() ?? { rows: [] };
  }
}

describe('PostgreSQL administrator and device repositories', () => {
  it('loads only active administrators and authenticates live sessions with role permissions', async () => {
    const pool = new FakePool([
      {
        rows: [
          {
            id: 'admin-id',
            display_name: '测试管理员',
            password_hash: 'argon-hash',
          },
        ],
      },
      { rows: [] },
      {
        rows: [
          {
            id: 'admin-id',
            session_id: 'session-id',
            display_name: '测试管理员',
            permissions: ['devices.read', 'sessions.view'],
            csrf_token_hash: 'b'.repeat(64),
            expires_at: '2026-10-28T08:00:00.000Z',
          },
        ],
      },
    ]);
    const repository = new PostgresAdminRepository(pool);

    await expect(repository.findActiveByUsername('ADMIN')).resolves.toEqual({
      id: 'admin-id',
      displayName: '测试管理员',
      passwordHash: 'argon-hash',
    });
    await repository.createSession({
      id: 'session-id',
      administratorId: 'admin-id',
      refreshTokenHash: 'a'.repeat(64),
      csrfTokenHash: 'b'.repeat(64),
      createdAt: new Date('2026-10-21T08:00:00.000Z'),
      expiresAt: new Date('2026-10-28T08:00:00.000Z'),
      lastSeenAt: new Date('2026-10-21T08:00:00.000Z'),
      userAgent: 'vitest',
      ipAddress: '127.0.0.1',
    });
    await expect(
      repository.findSessionByRefreshTokenHash(
        'a'.repeat(64),
        new Date('2026-10-21T08:01:00.000Z'),
      ),
    ).resolves.toEqual({
      sessionId: 'session-id',
      id: 'admin-id',
      displayName: '测试管理员',
      permissions: ['devices.read', 'sessions.view'],
      csrfTokenHash: 'b'.repeat(64),
      expiresAt: new Date('2026-10-28T08:00:00.000Z'),
    });
    expect(pool.statements[0]).toContain("status = 'active'");
    expect(pool.statements[2]).toContain('revoked_at IS NULL');
    expect(pool.statements[2]).toContain('GROUP BY a.id, s.id');
  });

  it('lists only devices explicitly granted to the administrator', async () => {
    const pool = new FakePool([
      {
        rows: [
          {
            id: 'device-id',
            name: '财务测试机',
            group_name: null,
            os_version: 'Windows 11',
            client_version: '0.1.0-test',
            online: true,
            last_seen_at: '2026-10-21T08:00:00.000Z',
          },
        ],
      },
    ]);
    const repository = new PostgresDeviceRepository(pool);

    const devices = await repository.listForAdministrator('admin-id');

    expect(devices[0]).toMatchObject({ name: '财务测试机', online: true });
    expect(pool.statements[0]).toContain('JOIN admin_device_grants');
    expect(pool.statements[0]).toContain('d.revoked_at IS NULL');
  });

  it('loads only active device credentials and records successful authentication', async () => {
    const pool = new FakePool([
      { rows: [{ id: 'device-id', public_key: Buffer.alloc(32, 1).toString('base64') }] },
      { rows: [{ id: 'device-id' }] },
      { rows: [{ id: 'device-id' }] },
    ]);
    const repository = new PostgresDeviceRepository(pool);

    await expect(repository.findActiveCredential('device-id')).resolves.toEqual({
      deviceId: 'device-id',
      publicKey: Buffer.alloc(32, 1).toString('base64'),
    });
    await expect(repository.recordAuthenticated({
      deviceId: 'device-id',
      clientVersion: '0.1.0-test',
      osVersion: 'Windows 11',
      authenticatedAt: new Date('2026-10-22T08:00:00.000Z'),
    })).resolves.toBe(true);
    await expect(
      repository.recordHeartbeat('device-id', new Date('2026-10-22T08:00:20.000Z')),
    ).resolves.toBe(true);

    expect(pool.statements[0]).toContain('revoked_at IS NULL');
    expect(pool.statements[1]).toContain('UPDATE devices');
    expect(pool.statements[1]).toContain('last_seen_at');
    expect(pool.statements[1]).toContain('revoked_at IS NULL');
    expect(pool.statements[2]).toContain('UPDATE devices');
    expect(pool.statements[2]).toContain('last_seen_at');
    expect(pool.statements[2]).toContain('revoked_at IS NULL');
  });

  it('updates or revokes only an administrator-authorized active device', async () => {
    const pool = new FakePool([{ rows: [{ id: 'device-id' }] }, { rows: [{ id: 'device-id' }] }]);
    const repository = new PostgresDeviceRepository(pool);

    await expect(repository.update({
      administratorId: 'admin-id', deviceId: 'device-id', name: '财务机', groupName: '财务部',
      now: new Date('2026-10-22T08:00:00.000Z'),
    })).resolves.toBe(true);
    await expect(repository.revoke({
      administratorId: 'admin-id', deviceId: 'device-id', now: new Date('2026-10-22T08:01:00.000Z'),
    })).resolves.toBe(true);

    expect(pool.statements[0]).toContain("'view' = ANY(adg.permissions)");
    expect(pool.statements[0]).toContain('d.revoked_at IS NULL');
    expect(pool.statements[1]).toContain("revoked_reason = '管理员撤销'");
    expect(pool.statements[1]).toContain('FROM admin_device_grants');
  });
});
