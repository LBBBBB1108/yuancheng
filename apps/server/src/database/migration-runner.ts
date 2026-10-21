import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export type MigrationDirection = 'up' | 'down';

interface MigrationClient {
  query(text: string, values?: readonly unknown[]): Promise<{
    rows: Array<Record<string, unknown>>;
  }>;
}

export async function runMigrations(
  client: MigrationClient,
  migrationsDirectory: string,
  direction: MigrationDirection,
): Promise<string[]> {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version text PRIMARY KEY,
    checksum char(64) NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);

  const appliedResult = await client.query(
    'SELECT version FROM schema_migrations ORDER BY version ASC',
  );
  const applied = new Set(appliedResult.rows.map((row) => String(row.version)));
  const files = await readdir(migrationsDirectory);

  if (direction === 'down') {
    const latest = [...applied].sort().at(-1);
    if (!latest) return [];
    await executeMigration(client, resolve(migrationsDirectory, `${latest}.down.sql`), async () => {
      await client.query('DELETE FROM schema_migrations WHERE version = $1', [latest]);
    });
    return [latest];
  }

  const pending = files
    .filter((file) => file.endsWith('.up.sql'))
    .map((file) => file.slice(0, -'.up.sql'.length))
    .filter((version) => !applied.has(version))
    .sort();

  for (const version of pending) {
    const filePath = resolve(migrationsDirectory, `${version}.up.sql`);
    const sql = await readFile(filePath, 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    await executeSql(client, sql, async () => {
      await client.query(
        'INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)',
        [version, checksum],
      );
    });
  }
  return pending;
}

async function executeMigration(
  client: MigrationClient,
  filePath: string,
  afterSql: () => Promise<void>,
): Promise<void> {
  const sql = await readFile(filePath, 'utf8');
  await executeSql(client, sql, afterSql);
}

async function executeSql(
  client: MigrationClient,
  sql: string,
  afterSql: () => Promise<void>,
): Promise<void> {
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await afterSql();
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
