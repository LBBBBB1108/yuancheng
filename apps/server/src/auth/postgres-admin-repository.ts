import type {
  AdminAuthRepository,
  StoredAdmin,
  StoredAdminSession,
  StoredAuthenticatedSession,
} from './admin-auth-service.js';
import type { AdminBootstrapRepository } from './admin-bootstrap-service.js';
import { randomUUID } from 'node:crypto';

interface QueryPool {
  query(text: string, values?: readonly unknown[]): Promise<{
    rows: Array<Record<string, unknown>>;
  }>;
}

interface TransactionClient extends QueryPool {
  release(): void;
}

interface TransactionPool extends QueryPool {
  connect(): Promise<TransactionClient>;
}

export class PostgresAdminRepository implements AdminAuthRepository, AdminBootstrapRepository {
  public constructor(private readonly pool: QueryPool) {}

  public async findActiveByUsername(username: string): Promise<StoredAdmin | null> {
    const result = await this.pool.query(
      `SELECT id, display_name, password_hash
         FROM administrators
        WHERE lower(username) = lower($1) AND status = 'active'
        LIMIT 1`,
      [username],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: String(row.id),
      displayName: String(row.display_name),
      passwordHash: String(row.password_hash),
    };
  }

  public async createSession(session: StoredAdminSession): Promise<void> {
    await this.pool.query(
      `INSERT INTO admin_sessions
         (id, administrator_id, refresh_token_hash, csrf_token_hash, created_at,
          expires_at, last_seen_at, user_agent, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        session.id,
        session.administratorId,
        session.refreshTokenHash,
        session.csrfTokenHash,
        session.createdAt,
        session.expiresAt,
        session.lastSeenAt,
        session.userAgent,
        session.ipAddress,
      ],
    );
  }

  public async findSessionByRefreshTokenHash(
    tokenHash: string,
    now: Date,
  ): Promise<StoredAuthenticatedSession | null> {
    const result = await this.pool.query(
      `SELECT a.id, a.display_name, s.id AS session_id, s.csrf_token_hash, s.expires_at,
              COALESCE(array_agg(DISTINCT permission) FILTER (WHERE permission IS NOT NULL), '{}') AS permissions
         FROM admin_sessions s
         JOIN administrators a ON a.id = s.administrator_id
         LEFT JOIN administrator_roles ar ON ar.administrator_id = a.id
         LEFT JOIN roles r ON r.id = ar.role_id
         LEFT JOIN LATERAL unnest(r.permissions) permission ON true
        WHERE s.refresh_token_hash = $1
          AND s.revoked_at IS NULL
          AND s.expires_at > $2
          AND a.status = 'active'
        GROUP BY a.id, s.csrf_token_hash`,
      [tokenHash, now],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      sessionId: String(row.session_id),
      id: String(row.id),
      displayName: String(row.display_name),
      permissions: Array.isArray(row.permissions)
        ? row.permissions.map((permission) => String(permission))
        : [],
      csrfTokenHash: String(row.csrf_token_hash),
      expiresAt: new Date(String(row.expires_at)),
    };
  }

  public async rotateSession(request: { refreshTokenHash: string; csrfTokenHash: string; replacement: StoredAdminSession; now: Date }): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE admin_sessions SET refresh_token_hash = $3, csrf_token_hash = $4, last_seen_at = $5, user_agent = $6, ip_address = $7
       WHERE refresh_token_hash = $1 AND csrf_token_hash = $2 AND revoked_at IS NULL AND expires_at > $5 RETURNING id`,
      [request.refreshTokenHash, request.csrfTokenHash, request.replacement.refreshTokenHash, request.replacement.csrfTokenHash, request.now, request.replacement.userAgent, request.replacement.ipAddress],
    );
    return result.rows.length === 1;
  }

  public async revokeSession(request: { refreshTokenHash: string; csrfTokenHash: string; now: Date }): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE admin_sessions SET revoked_at = $3 WHERE refresh_token_hash = $1 AND csrf_token_hash = $2 AND revoked_at IS NULL AND expires_at > $3 RETURNING id`,
      [request.refreshTokenHash, request.csrfTokenHash, request.now],
    );
    return result.rows.length === 1;
  }

  public async revokeAllSessions(administratorId: string, now: Date): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE admin_sessions SET revoked_at = $2 WHERE administrator_id = $1 AND revoked_at IS NULL AND expires_at > $2 RETURNING id`,
      [administratorId, now],
    );
    return result.rows.length > 0;
  }

  public async rotateCsrfToken(request: { refreshTokenHash: string; csrfTokenHash: string; now: Date }): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE admin_sessions SET csrf_token_hash = $2, last_seen_at = $3 WHERE refresh_token_hash = $1 AND revoked_at IS NULL AND expires_at > $3 RETURNING id`,
      [request.refreshTokenHash, request.csrfTokenHash, request.now],
    );
    return result.rows.length === 1;
  }

  public async initializeFirstAdministrator(request: { username: string; displayName: string; passwordHash: string }): Promise<boolean> {
    if (!('connect' in this.pool) || typeof this.pool.connect !== 'function') {
      throw new Error('数据库不支持管理员初始化事务');
    }
    const client = await (this.pool as TransactionPool).connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('yuancheng-admin-bootstrap'))");
      const existing = await client.query('SELECT id FROM administrators LIMIT 1');
      if (existing.rows.length > 0) {
        await client.query('ROLLBACK');
        return false;
      }
      const administratorId = randomUUID();
      const roleId = randomUUID();
      const permissions = ['admins.manage', 'devices.read', 'devices.manage', 'sessions.view', 'sessions.control', 'files.upload', 'files.download', 'audit.read'];
      await client.query('INSERT INTO roles (id, name, permissions) VALUES ($1, $2, $3)', [roleId, '管理员', permissions]);
      await client.query('INSERT INTO administrators (id, username, display_name, password_hash) VALUES ($1, $2, $3, $4)', [administratorId, request.username, request.displayName, request.passwordHash]);
      await client.query('INSERT INTO administrator_roles (administrator_id, role_id) VALUES ($1, $2)', [administratorId, roleId]);
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
