import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const migrationsDirectory = resolve(import.meta.dirname, '../../../migrations');

describe('initial PostgreSQL migration', () => {
  it('defines the identity, authorization, session, transfer and audit tables', async () => {
    const sql = await readFile(resolve(migrationsDirectory, '001_initial.up.sql'), 'utf8');

    for (const table of [
      'administrators',
      'roles',
      'admin_sessions',
      'devices',
      'pairing_tokens',
      'admin_device_grants',
      'test_authorizations',
      'remote_sessions',
      'control_leases',
      'file_transfers',
      'audit_events',
    ]) {
      expect(sql).toContain(`CREATE TABLE ${table}`);
    }
    expect(sql).toContain('WHERE released_at IS NULL');
    expect(sql).toContain('CHECK (permissions <@');
  });

  it('provides a rollback migration for every initial table', async () => {
    const sql = await readFile(resolve(migrationsDirectory, '001_initial.down.sql'), 'utf8');

    expect(sql).toContain('DROP TABLE administrators');
    expect(sql).toContain('DROP TABLE devices');
    expect(sql).toContain('DROP TABLE audit_events');
  });
});
