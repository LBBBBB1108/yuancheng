import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import argon2 from 'argon2';

export interface StoredAdmin {
  id: string;
  displayName: string;
  passwordHash: string;
}

export interface StoredAdminSession {
  id: string;
  administratorId: string;
  refreshTokenHash: string;
  csrfTokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  lastSeenAt: Date;
  userAgent: string | null;
  ipAddress: string | null;
}

export interface AdminAuthRepository {
  findActiveByUsername(username: string): Promise<StoredAdmin | null>;
  createSession(session: StoredAdminSession): Promise<void>;
  findSessionByRefreshTokenHash(
    tokenHash: string,
    now: Date,
  ): Promise<StoredAuthenticatedSession | null>;
  rotateSession(request: {
    refreshTokenHash: string;
    csrfTokenHash: string;
    replacement: StoredAdminSession;
    now: Date;
  }): Promise<boolean>;
  revokeSession(request: { refreshTokenHash: string; csrfTokenHash: string; now: Date }): Promise<boolean>;
  revokeAllSessions(administratorId: string, now: Date): Promise<boolean>;
  rotateCsrfToken(request: { refreshTokenHash: string; csrfTokenHash: string; now: Date }): Promise<boolean>;
}

export interface StoredAuthenticatedSession {
  sessionId: string;
  id: string;
  displayName: string;
  permissions: string[];
  csrfTokenHash: string;
  expiresAt: Date;
}

export interface StoredAuthenticatedSession {
  sessionId: string;
  id: string;
  displayName: string;
  permissions: string[];
  csrfTokenHash: string;
  expiresAt: Date;
}

export interface LoginRequest {
  username: string;
  password: string;
  now: Date;
  userAgent: string | null;
  ipAddress: string | null;
}

export interface LoginResult {
  admin: { id: string; displayName: string };
  refreshToken: string;
  csrfToken: string;
  expiresAt: Date;
}

export class AdminAuthService {
  public constructor(private readonly repository: AdminAuthRepository) {}

  public async login(request: LoginRequest): Promise<LoginResult | null> {
    const username = request.username.trim();
    if (username.length < 1 || username.length > 80 || request.password.length > 256) {
      return null;
    }

    const admin = await this.repository.findActiveByUsername(username);
    if (!admin) return null;

    let passwordMatches = false;
    try {
      passwordMatches = await argon2.verify(admin.passwordHash, request.password);
    } catch {
      return null;
    }
    if (!passwordMatches) return null;

    const refreshToken = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(request.now.getTime() + 7 * 24 * 60 * 60 * 1000);
    await this.repository.createSession({
      id: randomUUID(),
      administratorId: admin.id,
      refreshTokenHash: sha256(refreshToken),
      csrfTokenHash: sha256(csrfToken),
      createdAt: request.now,
      expiresAt,
      lastSeenAt: request.now,
      userAgent: request.userAgent,
      ipAddress: request.ipAddress,
    });

    return {
      admin: { id: admin.id, displayName: admin.displayName },
      refreshToken,
      csrfToken,
      expiresAt,
    };
  }

  public async authenticate(
    refreshToken: string,
    now: Date,
  ): Promise<{ id: string; permissions: string[] } | null> {
    if (refreshToken.length !== 43 || !/^[A-Za-z0-9_-]+$/.test(refreshToken)) {
      return null;
    }
    const session = await this.repository.findSessionByRefreshTokenHash(
      sha256(refreshToken),
      now,
    );
    return session ? { id: session.id, permissions: session.permissions } : null;
  }

  public async authenticateMutation(
    refreshToken: string,
    csrfToken: string,
    now: Date,
  ): Promise<{ id: string; permissions: string[] } | null> {
    if (
      refreshToken.length !== 43 ||
      csrfToken.length !== 43 ||
      !/^[A-Za-z0-9_-]+$/.test(refreshToken) ||
      !/^[A-Za-z0-9_-]+$/.test(csrfToken)
    ) {
      return null;
    }
    const session = await this.repository.findSessionByRefreshTokenHash(
      sha256(refreshToken),
      now,
    );
    if (!session) return null;

    const actual = Buffer.from(session.csrfTokenHash, 'hex');
    const expected = Buffer.from(sha256(csrfToken), 'hex');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      return null;
    }
    return { id: session.id, permissions: session.permissions };
  }

  public async refresh(
    refreshToken: string,
    csrfToken: string,
    now: Date,
    userAgent: string | null,
    ipAddress: string | null,
  ): Promise<LoginResult | null> {
    const session = await this.authenticateSessionMutation(refreshToken, csrfToken, now);
    if (!session) return null;

    const nextRefreshToken = randomBytes(32).toString('base64url');
    const nextCsrfToken = randomBytes(32).toString('base64url');
    const rotated = await this.repository.rotateSession({
      refreshTokenHash: sha256(refreshToken),
      csrfTokenHash: sha256(csrfToken),
      replacement: {
        id: session.sessionId,
        administratorId: session.id,
        refreshTokenHash: sha256(nextRefreshToken),
        csrfTokenHash: sha256(nextCsrfToken),
        createdAt: now,
        expiresAt: session.expiresAt,
        lastSeenAt: now,
        userAgent,
        ipAddress,
      },
      now,
    });
    if (!rotated) return null;
    return {
      admin: { id: session.id, displayName: session.displayName },
      refreshToken: nextRefreshToken,
      csrfToken: nextCsrfToken,
      expiresAt: session.expiresAt,
    };
  }

  public async getSession(refreshToken: string, now: Date): Promise<{
    admin: { id: string; displayName: string }; permissions: string[]; expiresAt: Date;
  } | null> {
    if (refreshToken.length !== 43 || !/^[A-Za-z0-9_-]+$/.test(refreshToken)) return null;
    const session = await this.repository.findSessionByRefreshTokenHash(sha256(refreshToken), now);
    return session ? { admin: { id: session.id, displayName: session.displayName }, permissions: session.permissions, expiresAt: session.expiresAt } : null;
  }

  public async logout(refreshToken: string, csrfToken: string, now: Date): Promise<boolean> {
    const session = await this.authenticateSessionMutation(refreshToken, csrfToken, now);
    return session ? this.repository.revokeSession({ refreshTokenHash: sha256(refreshToken), csrfTokenHash: sha256(csrfToken), now }) : false;
  }

  public async logoutAll(refreshToken: string, csrfToken: string, now: Date): Promise<boolean> {
    const session = await this.authenticateSessionMutation(refreshToken, csrfToken, now);
    return session ? this.repository.revokeAllSessions(session.id, now) : false;
  }

  public async rotateCsrf(refreshToken: string, now: Date): Promise<string | null> {
    if (refreshToken.length !== 43 || !/^[A-Za-z0-9_-]+$/.test(refreshToken)) return null;
    const csrfToken = randomBytes(32).toString('base64url');
    const rotated = await this.repository.rotateCsrfToken({ refreshTokenHash: sha256(refreshToken), csrfTokenHash: sha256(csrfToken), now });
    return rotated ? csrfToken : null;
  }

  private async authenticateSessionMutation(
    refreshToken: string,
    csrfToken: string,
    now: Date,
  ): Promise<StoredAuthenticatedSession | null> {
    if (
      refreshToken.length !== 43 || csrfToken.length !== 43 ||
      !/^[A-Za-z0-9_-]+$/.test(refreshToken) || !/^[A-Za-z0-9_-]+$/.test(csrfToken)
    ) return null;
    const session = await this.repository.findSessionByRefreshTokenHash(sha256(refreshToken), now);
    if (!session) return null;
    const actual = Buffer.from(session.csrfTokenHash, 'hex');
    const expected = Buffer.from(sha256(csrfToken), 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected) ? session : null;
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
