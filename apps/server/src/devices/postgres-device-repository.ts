import type { DeviceSummary } from '../app.js';

interface QueryPool {
  query(text: string, values?: readonly unknown[]): Promise<{
    rows: Array<Record<string, unknown>>;
  }>;
}

export class PostgresDeviceRepository {
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
}

function toIsoString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}
