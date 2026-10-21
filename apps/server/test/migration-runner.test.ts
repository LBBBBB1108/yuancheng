import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runMigrations } from '../src/database/migration-runner.js';

class FakeMigrationClient {
  public readonly statements: string[] = [];

  public constructor(private readonly appliedVersions: string[]) {}

  async query(text: string): Promise<{ rows: Array<Record<string, unknown>> }> {
    this.statements.push(text);
    if (text.includes('SELECT version FROM schema_migrations')) {
      return { rows: this.appliedVersions.map((version) => ({ version })) };
    }
    return { rows: [] };
  }
}

const migrationsDirectory = resolve(import.meta.dirname, '../../../migrations');

describe('runMigrations', () => {
  it('applies pending up migrations and records their checksums', async () => {
    const client = new FakeMigrationClient([]);

    const result = await runMigrations(client, migrationsDirectory, 'up');

    expect(result).toEqual(['001_initial']);
    expect(client.statements.some((sql) => sql.includes('CREATE TABLE administrators'))).toBe(true);
    expect(client.statements.some((sql) => sql.includes('INSERT INTO schema_migrations'))).toBe(true);
    expect(client.statements.at(-1)).toBe('COMMIT');
  });

  it('rolls back only the most recent applied migration', async () => {
    const client = new FakeMigrationClient(['001_initial']);

    const result = await runMigrations(client, migrationsDirectory, 'down');

    expect(result).toEqual(['001_initial']);
    expect(client.statements.some((sql) => sql.includes('DROP TABLE administrators'))).toBe(true);
    expect(client.statements.some((sql) => sql.includes('DELETE FROM schema_migrations'))).toBe(true);
  });
});
