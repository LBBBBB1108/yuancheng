import { randomUUID } from 'node:crypto';

import type {
  EnrollmentRepository,
  EnrollmentResult,
  EnrollmentTransaction,
} from './enrollment-service.js';

interface QueryResult {
  rows: Array<Record<string, unknown>>;
}

interface DatabaseClient {
  query(text: string, values?: readonly unknown[]): Promise<QueryResult>;
  release(): void;
}

interface DatabasePool {
  connect(): Promise<DatabaseClient>;
}

export class PostgresEnrollmentRepository implements EnrollmentRepository {
  public constructor(private readonly pool: DatabasePool) {}

  public async enroll(transaction: EnrollmentTransaction): Promise<EnrollmentResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('yuancheng:device-enrollment'))",
      );

      const tokenResult = await client.query(
        `SELECT id, expires_at
           FROM pairing_tokens
          WHERE token_hash = $1 AND consumed_at IS NULL
          FOR UPDATE`,
        [transaction.tokenHash],
      );
      const token = tokenResult.rows[0];
      if (!token) {
        await client.query('COMMIT');
        return { status: 'invalid_token' };
      }

      if (new Date(String(token.expires_at)).getTime() <= transaction.now.getTime()) {
        await client.query('COMMIT');
        return { status: 'expired_token' };
      }

      const countResult = await client.query(
        'SELECT count(*)::text AS count FROM devices WHERE revoked_at IS NULL',
      );
      const activeDeviceCount = Number(countResult.rows[0]?.count ?? 0);
      if (activeDeviceCount >= transaction.maximumActiveDevices) {
        await client.query('COMMIT');
        return { status: 'device_limit_reached' };
      }

      const deviceId = randomUUID();
      const deviceResult = await client.query(
        `INSERT INTO devices
           (id, name, public_key, os_version, client_version, enrolled_at, last_seen_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6)
         RETURNING id`,
        [
          deviceId,
          transaction.deviceName,
          transaction.publicKey,
          transaction.osVersion,
          transaction.clientVersion,
          transaction.now,
        ],
      );
      const insertedDeviceId = String(deviceResult.rows[0]?.id ?? deviceId);

      await client.query(
        'UPDATE pairing_tokens SET consumed_at = $1, consumed_by_device_id = $2 WHERE id = $3',
        [transaction.now, insertedDeviceId, token.id],
      );
      await client.query(
        `INSERT INTO audit_events (event_type, device_id, occurred_at, outcome, metadata)
         VALUES ('device.enrolled', $1, $2, 'success', $3::jsonb)`,
        [
          insertedDeviceId,
          transaction.now,
          JSON.stringify({
            clientVersion: transaction.clientVersion,
            osVersion: transaction.osVersion,
          }),
        ],
      );
      await client.query('COMMIT');
      return { status: 'registered', deviceId: insertedDeviceId };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
