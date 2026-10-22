import { resolve } from 'node:path';

import pg from 'pg';

import { loadConfig } from '../config.js';
import { runMigrations, type MigrationDirection } from './migration-runner.js';

const direction = process.argv[2];
if (direction !== 'up' && direction !== 'down') {
  throw new Error('迁移方向必须是 up 或 down');
}

const config = loadConfig(process.env);
const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 1 });
const client = await pool.connect();
const migrationsDirectory = resolve(import.meta.dirname, '../../../../migrations');

try {
  const applied = await runMigrations(
    client,
    migrationsDirectory,
    direction satisfies MigrationDirection,
  );
  process.stdout.write(
    applied.length > 0 ? `已处理迁移：${applied.join(', ')}\n` : '没有需要处理的迁移。\n',
  );
} finally {
  client.release();
  await pool.end();
}
