import argon2 from 'argon2';

export interface AdminBootstrapRepository {
  initializeFirstAdministrator(request: {
    username: string;
    displayName: string;
    passwordHash: string;
  }): Promise<boolean>;
}

export class AdminBootstrapService {
  public constructor(private readonly repository: AdminBootstrapRepository) {}

  public async initialize(request: {
    username: string;
    displayName: string;
    password: string;
  }): Promise<'created' | 'already_initialized' | 'invalid'> {
    const username = request.username.trim();
    const displayName = request.displayName.trim();
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(username) || displayName.length < 1 || displayName.length > 80 || request.password.length < 12 || request.password.length > 256) return 'invalid';
    const passwordHash = await argon2.hash(request.password, { type: argon2.argon2id });
    return await this.repository.initializeFirstAdministrator({ username, displayName, passwordHash }) ? 'created' : 'already_initialized';
  }
}
