import type { DeviceSummary } from '../app.js';
import { randomUUID } from 'node:crypto';
import type {
  ActiveDeviceCredential,
  DeviceAuthRepository,
  RecordAuthenticationRequest,
} from './device-auth-service.js';
import type { DeviceManagementRepository, DeviceManagementRequest } from './device-management-service.js';
import type {
  ActiveTestAuthorization,
  TestAuthorizationCandidate,
  TestAuthorizationRepository,
  TestAuthorizationSummary,
} from './test-authorization-service.js';

interface QueryPool {
  query(text: string, values?: readonly unknown[]): Promise<{
    rows: Array<Record<string, unknown>>;
  }>;
}

export class PostgresDeviceRepository implements DeviceAuthRepository, DeviceManagementRepository, TestAuthorizationRepository {
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

  public async update(request: DeviceManagementRequest): Promise<boolean> {
    const result = await this.pool.query(
      `WITH authorized_device AS (
         SELECT d.id
           FROM devices d
           JOIN admin_device_grants adg ON adg.device_id = d.id
          WHERE d.id = $2
            AND adg.administrator_id = $1
            AND 'view' = ANY(adg.permissions)
            AND d.revoked_at IS NULL
       ), selected_group AS (
         INSERT INTO device_groups (id, name)
         SELECT $3, $5 FROM authorized_device WHERE $5 IS NOT NULL
         ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
         RETURNING id
       )
       UPDATE devices d
          SET name = $4,
              group_id = CASE WHEN $5 IS NULL THEN NULL ELSE (SELECT id FROM selected_group) END
         FROM authorized_device
        WHERE d.id = authorized_device.id
       RETURNING d.id`,
      [request.administratorId, request.deviceId, randomUUID(), request.name, request.groupName],
    );
    return result.rows.length === 1;
  }

  public async revoke(request: { administratorId: string; deviceId: string; now: Date }): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE devices d
          SET revoked_at = $3,
              revoked_reason = '管理员撤销'
         FROM admin_device_grants adg
        WHERE d.id = $2
          AND adg.device_id = d.id
          AND adg.administrator_id = $1
          AND 'view' = ANY(adg.permissions)
          AND d.revoked_at IS NULL
      RETURNING d.id`,
      [request.administratorId, request.deviceId, request.now],
    );
    return result.rows.length === 1;
  }

  public async get(request: { actorAdministratorId: string; deviceId: string; now: Date }): Promise<{
    authorization: TestAuthorizationSummary | null;
    candidates: TestAuthorizationCandidate[];
  } | null> {
    const result = await this.pool.query(
      `SELECT candidate.id AS candidate_id, candidate.display_name AS candidate_display_name,
              ta.administrator_id AS authorized_administrator_id,
              authorized.display_name AS authorized_display_name, ta.valid_until
         FROM devices d
         JOIN admin_device_grants actor_grant ON actor_grant.device_id = d.id
         JOIN admin_device_grants candidate_grant ON candidate_grant.device_id = d.id
         JOIN administrators candidate ON candidate.id = candidate_grant.administrator_id
         LEFT JOIN test_authorizations ta ON ta.device_id = d.id AND ta.valid_until > $3
         LEFT JOIN administrators authorized ON authorized.id = ta.administrator_id
        WHERE d.id = $2 AND d.revoked_at IS NULL
          AND actor_grant.administrator_id = $1 AND 'view' = ANY(actor_grant.permissions)
          AND 'view' = ANY(candidate_grant.permissions) AND candidate.status = 'active'
        ORDER BY candidate.display_name ASC`,
      [request.actorAdministratorId, request.deviceId, request.now],
    );
    const first = result.rows[0];
    if (!first) return null;
    const authorization = first.authorized_administrator_id === null || first.authorized_administrator_id === undefined
      ? null
      : { administratorId: String(first.authorized_administrator_id), displayName: String(first.authorized_display_name), validUntil: new Date(String(first.valid_until)) };
    return { authorization, candidates: result.rows.map((row) => ({ id: String(row.candidate_id), displayName: String(row.candidate_display_name) })) };
  }

  public async grant(request: {
    actorAdministratorId: string; deviceId: string; designatedAdministratorId: string; validUntil: Date; now: Date;
  }): Promise<boolean> {
    const result = await this.pool.query(
      `WITH authorized_device AS (
         SELECT d.id FROM devices d JOIN admin_device_grants actor_grant ON actor_grant.device_id = d.id
          WHERE d.id = $2 AND d.revoked_at IS NULL AND actor_grant.administrator_id = $1
            AND 'view' = ANY(actor_grant.permissions)
       ), designated_administrator AS (
         SELECT administrator.id FROM administrators administrator
         JOIN admin_device_grants designated_grant ON designated_grant.administrator_id = administrator.id
          WHERE administrator.id = $3 AND administrator.status = 'active' AND designated_grant.device_id = $2
            AND 'view' = ANY(designated_grant.permissions)
       ), authorization AS (
         INSERT INTO test_authorizations (device_id, administrator_id, valid_until, renewed_by, renewed_at)
         SELECT authorized_device.id, designated_administrator.id, $4, $1, $5 FROM authorized_device CROSS JOIN designated_administrator
         ON CONFLICT (device_id) DO UPDATE SET administrator_id = EXCLUDED.administrator_id,
           valid_until = EXCLUDED.valid_until, renewed_by = EXCLUDED.renewed_by, renewed_at = EXCLUDED.renewed_at
         RETURNING device_id
       )
       INSERT INTO audit_events (event_type, administrator_id, device_id, occurred_at, outcome, metadata)
       SELECT 'test_authorization.updated', $1, authorization.device_id, $5, 'success',
              jsonb_build_object('designatedAdministratorId', $3, 'validUntil', $4)
         FROM authorization RETURNING device_id`,
      [request.actorAdministratorId, request.deviceId, request.designatedAdministratorId, request.validUntil, request.now],
    );
    return result.rows.length === 1;
  }

  public async getActiveForDevice(deviceId: string, now: Date): Promise<ActiveTestAuthorization | null> {
    const result = await this.pool.query(
      `SELECT ta.administrator_id, ta.valid_until FROM test_authorizations ta
       JOIN devices d ON d.id = ta.device_id JOIN administrators administrator ON administrator.id = ta.administrator_id
       WHERE ta.device_id = $1 AND ta.valid_until > $2 AND d.revoked_at IS NULL AND administrator.status = 'active'`,
      [deviceId, now],
    );
    const row = result.rows[0];
    return row ? { administratorId: String(row.administrator_id), validUntil: new Date(String(row.valid_until)) } : null;
  }
}

function toIsoString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}
