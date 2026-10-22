import argon2 from 'argon2';
import { describe, expect, it } from 'vitest';

import { AdminBootstrapService, type AdminBootstrapRepository } from '../src/auth/admin-bootstrap-service.js';

class MemoryBootstrapRepository implements AdminBootstrapRepository {
  public created: { username: string; displayName: string; passwordHash: string } | undefined;
  public constructor(private readonly result = true) {}

  async initializeFirstAdministrator(request: { username: string; displayName: string; passwordHash: string }): Promise<boolean> {
    this.created = request;
    return this.result;
  }
}

describe('AdminBootstrapService', () => {
  it('creates only a valid first administrator with an Argon2id hash', async () => {
    const repository = new MemoryBootstrapRepository();
    const service = new AdminBootstrapService(repository);

    await expect(service.initialize({
      username: 'first.admin', displayName: '首位管理员', password: 'a-safe-long-password',
    })).resolves.toBe('created');
    expect(repository.created).toMatchObject({ username: 'first.admin', displayName: '首位管理员' });
    await expect(argon2.verify(repository.created?.passwordHash ?? '', 'a-safe-long-password')).resolves.toBe(true);
    expect(repository.created?.passwordHash).toContain('$argon2id$');
  });

  it('accepts an email address as the first administrator identifier', async () => {
    const repository = new MemoryBootstrapRepository();
    const service = new AdminBootstrapService(repository);

    await expect(service.initialize({
      username: 'xiangniantadeyangzi@gmail.com', displayName: 'Q', password: 'a-safe-long-password',
    })).resolves.toBe('created');
    expect(repository.created).toMatchObject({ username: 'xiangniantadeyangzi@gmail.com', displayName: 'Q' });
  });

  it('does not call the repository for invalid administrator input', async () => {
    const repository = new MemoryBootstrapRepository();
    const service = new AdminBootstrapService(repository);

    await expect(service.initialize({ username: 'bad space', displayName: '', password: 'short' })).resolves.toBe('invalid');
    expect(repository.created).toBeUndefined();
  });

  it('reports an existing administrator without overwriting it', async () => {
    const repository = new MemoryBootstrapRepository(false);
    const service = new AdminBootstrapService(repository);

    await expect(service.initialize({
      username: 'first.admin', displayName: '首位管理员', password: 'a-safe-long-password',
    })).resolves.toBe('already_initialized');
  });
});
