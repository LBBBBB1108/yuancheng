import type { PairingRepository, StoredPairingToken } from './pairing-service.js';

interface DatabaseClient {
  query(text: string, values?: readonly unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  release(): void;
}

interface DatabasePool {
  connect(): Promise<DatabaseClient>;
}

export class PostgresPairingRepository implements PairingRepository {
  public constructor(private readonly pool: DatabasePool) {}

  public async create(token: StoredPairingToken): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO pairing_tokens
           (id, token_hash, requested_device_name, created_by, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          token.id,
          token.tokenHash,
          token.requestedDeviceName,
          token.createdBy,
          token.createdAt,
          token.expiresAt,
        ],
      );
      await client.query(
        `INSERT INTO audit_events
           (event_type, administrator_id, occurred_at, outcome, metadata)
         VALUES ('pairing.created', $1, $2, 'success', $3::jsonb)`,
        [
          token.createdBy,
          token.createdAt,
          JSON.stringify({
            pairingTokenId: token.id,
            requestedDeviceName: token.requestedDeviceName,
            expiresAt: token.expiresAt.toISOString(),
          }),
        ],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
