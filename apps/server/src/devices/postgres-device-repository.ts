import type { DeviceSummary } from '../app.js';
import type {
  ActiveDeviceCredential,
  DeviceAuthRepository,
  RecordAuthenticationRequest,
} from './device-auth-service.js';

interface QueryPool {
  query(text: string, values?: readonly unknown[]): Promise<{
    rows: Array<Record<string, unknown>>;
  }>;
}

export class PostgresDeviceRepository implements DeviceAuthRepository {
  public constructor(private readonly pool: QueryPool) {}

  public async listForAdministrator(administratorId: string): Promise<DeviceSummary[]> {
    const result = await this.pool.query(
      `SELECT d.id, d.name, g.name AS group_name, d.os_version, d.client_version,
              (d.last_seen_at > now() - interval '60 seconds') AS online,
              d.last_seen_at
         FROM devices d
         JOIN admin_device_grants adg ON adg.device_id = d.id
         LEFT JOIN device_groups g ON g.id = d.group_id
        WHERE adg.administrator_id = $1
          AND 'view' = ANY(adg.permissions)
          AND d.revoked_at IS NULL
        ORDER BY d.name ASC`,
      [administratorId],
    );

    return result.rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      groupName: row.group_name === null || row.group_name === undefined
        ? null
        : String(row.group_name),
      osVersion: String(row.os_version),
      clientVersion: String(row.client_version),
      online: Boolean(row.online),
      lastSeenAt: toIsoString(row.last_seen_at),
    }));
  }

  public async findActiveCredential(deviceId: string): Promise<ActiveDeviceCredential | null> {
    const result = await this.pool.query(
      `SELECT id, public_key
         FROM devices
        WHERE id = $1
          AND revoked_at IS NULL`,
      [deviceId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return { deviceId: String(row.id), publicKey: String(row.public_key) };
  }

  public async recordAuthenticated(request: RecordAuthenticationRequest): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE devices
          SET client_version = $2,
              os_version = $3,
              last_seen_at = $4
        WHERE id = $1
          AND revoked_at IS NULL
      RETURNING id`,
      [
        request.deviceId,
        request.clientVersion,
        request.osVersion,
        request.authenticatedAt,
      ],
    );
    return result.rows.length === 1;
  }

  public async recordHeartbeat(deviceId: string, seenAt: Date): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE devices
          SET last_seen_at = $2
        WHERE id = $1
          AND revoked_at IS NULL
      RETURNING id`,
      [deviceId, seenAt],
    );
    return result.rows.length === 1;
  }
}

function toIsoString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}
