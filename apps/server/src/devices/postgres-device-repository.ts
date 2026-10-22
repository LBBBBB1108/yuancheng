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
import type { ConsentRequest, ConsentRequestRepository } from '../consent/consent-request-service.js';

interface QueryPool {
  query(text: string, values?: readonly unknown[]): Promise<{
    rows: Array<Record<string, unknown>>;
  }>;
}

export class PostgresDeviceRepository implements DeviceAuthRepository, DeviceManagementRepository, TestAuthorizationRepository, ConsentRequestRepository {
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

  public async createConsent(request: Omit<ConsentRequest, 'id' | 'status'>): Promise<{ status: 'created'; request: ConsentRequest } | { status: 'already_open' } | { status: 'not_found' }> {
    const id = randomUUID();
    const result = await this.pool.query(
      `WITH authorized AS (
         SELECT d.id FROM devices d JOIN admin_device_grants device_grant ON device_grant.device_id = d.id
          WHERE d.id = $3 AND d.revoked_at IS NULL AND device_grant.administrator_id = $2
            AND $4::text[] <@ device_grant.permissions
       ), open_request AS (
         SELECT 1 FROM remote_sessions WHERE device_id = $3 AND status IN ('pending', 'authorized')
       ), created AS (
         INSERT INTO remote_sessions (id, administrator_id, device_id, requested_permissions, status, mode, requested_at)
         SELECT $1, $2, authorized.id, $4, 'pending', 'production', $5 FROM authorized
          WHERE NOT EXISTS (SELECT 1 FROM open_request)
         RETURNING id, administrator_id, device_id, requested_permissions, status, requested_at
       )
       SELECT created.*, EXISTS(SELECT 1 FROM authorized) AS authorized, EXISTS(SELECT 1 FROM open_request) AS already_open FROM created
       UNION ALL SELECT NULL, NULL, NULL, NULL, NULL, NULL, EXISTS(SELECT 1 FROM authorized), EXISTS(SELECT 1 FROM open_request)
        WHERE NOT EXISTS(SELECT 1 FROM created)`,
      [id, request.administratorId, request.deviceId, request.permissions, request.requestedAt],
    );
    const row = result.rows[0];
    if (!row || !Boolean(row.authorized)) return { status: 'not_found' };
    if (Boolean(row.already_open)) return { status: 'already_open' };
    const created: ConsentRequest = { id, administratorId: request.administratorId, administratorDisplayName: request.administratorDisplayName, deviceId: request.deviceId, permissions: request.permissions, status: 'pending', requestedAt: request.requestedAt, expiresAt: request.expiresAt };
    await this.pool.query(`INSERT INTO audit_events (event_type, administrator_id, device_id, session_id, occurred_at, outcome, metadata) VALUES ('consent.requested', $1, $2, $3, $4, 'success', jsonb_build_object('permissions', $5::text[]))`, [request.administratorId, request.deviceId, id, request.requestedAt, request.permissions]);
    return { status: 'created', request: created };
  }

  public async getConsent(requestId: string, administratorId: string, now: Date): Promise<ConsentRequest | null> {
    await this.expire(now);
    const result = await this.pool.query(`SELECT rs.id, rs.administrator_id, a.display_name, rs.device_id, rs.requested_permissions, rs.status, rs.requested_at FROM remote_sessions rs JOIN administrators a ON a.id = rs.administrator_id WHERE rs.id = $1 AND rs.administrator_id = $2`, [requestId, administratorId]);
    const row = result.rows[0];
    if (!row) return null;
    const requestedAt = new Date(String(row.requested_at));
    return { id: String(row.id), administratorId: String(row.administrator_id), administratorDisplayName: String(row.display_name), deviceId: String(row.device_id), permissions: row.requested_permissions as ConsentRequest['permissions'], status: String(row.status) as ConsentRequest['status'], requestedAt, expiresAt: new Date(requestedAt.getTime() + 60_000) };
  }

  public async respond(request: { requestId: string; deviceId: string; accepted: boolean; now: Date }): Promise<'authorized' | 'rejected' | 'timed_out' | 'ended' | 'not_found'> {
    await this.expire(request.now);
    const status = request.accepted ? 'authorized' : 'rejected';
    const result = await this.pool.query(`UPDATE remote_sessions SET status = $4, authorized_at = CASE WHEN $4 = 'authorized' THEN $3 ELSE NULL END WHERE id = $1 AND device_id = $2 AND status = 'pending' AND requested_at + interval '60 seconds' > $3 RETURNING status, administrator_id, requested_permissions`, [request.requestId, request.deviceId, request.now, status]);
    if (result.rows[0]) {
      await this.pool.query(`INSERT INTO audit_events (event_type, administrator_id, device_id, session_id, occurred_at, outcome, metadata) VALUES ('consent.responded', $1, $2, $3, $4, 'success', jsonb_build_object('accepted', $5))`, [result.rows[0].administrator_id, request.deviceId, request.requestId, request.now, request.accepted]);
      return status;
    }
    const current = await this.pool.query(`SELECT status FROM remote_sessions WHERE id = $1 AND device_id = $2`, [request.requestId, request.deviceId]);
    return current.rows[0] ? String(current.rows[0].status) as 'timed_out' | 'ended' : 'not_found';
  }

  public async end(request: { requestId: string; administratorId: string; now: Date; reason: string }): Promise<'ended' | 'not_found' | 'terminal'> {
    const result = await this.pool.query(`UPDATE remote_sessions SET status = 'ended', ended_at = $3, end_reason = $4 WHERE id = $1 AND administrator_id = $2 AND status IN ('pending', 'authorized') RETURNING device_id`, [request.requestId, request.administratorId, request.now, request.reason]);
    if (result.rows[0]) return 'ended';
    const current = await this.pool.query(`SELECT 1 FROM remote_sessions WHERE id = $1 AND administrator_id = $2`, [request.requestId, request.administratorId]);
    return current.rows[0] ? 'terminal' : 'not_found';
  }

  public async expire(now: Date): Promise<void> {
    await this.pool.query(`UPDATE remote_sessions SET status = 'timed_out', ended_at = $1, end_reason = '确认超时' WHERE status = 'pending' AND requested_at + interval '60 seconds' <= $1`, [now]);
  }

  public async endOpenForDevice(deviceId: string, now: Date, reason: string): Promise<void> {
    await this.pool.query(`UPDATE remote_sessions SET status = 'ended', ended_at = $2, end_reason = $3 WHERE device_id = $1 AND status IN ('pending', 'authorized')`, [deviceId, now, reason]);
  }

  public async endAllOpenOnStartup(now: Date): Promise<void> {
    await this.pool.query(`UPDATE remote_sessions SET status = 'ended', ended_at = $1, end_reason = '服务重启' WHERE status IN ('pending', 'authorized')`, [now]);
  }
}

function toIsoString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}
