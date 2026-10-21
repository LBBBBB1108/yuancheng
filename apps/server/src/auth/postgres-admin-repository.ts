import type {
  AdminAuthRepository,
  StoredAdmin,
  StoredAdminSession,
} from './admin-auth-service.js';

interface QueryPool {
  query(text: string, values?: readonly unknown[]): Promise<{
    rows: Array<Record<string, unknown>>;
  }>;
}

export class PostgresAdminRepository implements AdminAuthRepository {
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
  ): Promise<{ id: string; permissions: string[]; csrfTokenHash: string } | null> {
    const result = await this.pool.query(
      `SELECT a.id, s.csrf_token_hash,
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
      id: String(row.id),
      permissions: Array.isArray(row.permissions)
        ? row.permissions.map((permission) => String(permission))
        : [],
      csrfTokenHash: String(row.csrf_token_hash),
    };
  }
}
