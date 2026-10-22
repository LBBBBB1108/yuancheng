import { describe, expect, it } from 'vitest';

import {
  TestAuthorizationService,
  type TestAuthorizationRepository,
} from '../src/devices/test-authorization-service.js';

class MemoryRepository implements TestAuthorizationRepository {
  public grantRequest: Parameters<TestAuthorizationRepository['grant']>[0] | undefined;

  async get(): Promise<{ authorization: null; candidates: [] }> {
    return { authorization: null, candidates: [] };
  }

  async grant(request: Parameters<TestAuthorizationRepository['grant']>[0]): Promise<boolean> {
    this.grantRequest = request;
    return true;
  }

  async getActiveForDevice(): Promise<null> {
    return null;
  }
}

describe('TestAuthorizationService', () => {
  it('grants a fixed seven-day authorization from the explicit renewal time', async () => {
    const repository = new MemoryRepository();
    const service = new TestAuthorizationService(repository);
    const now = new Date('2026-10-22T08:00:00.000Z');

    await expect(service.grant({
      actorAdministratorId: 'actor-id', deviceId: '19d7b60c-f258-4be3-8e5a-698670687843',
      designatedAdministratorId: 'target-id', now,
    })).resolves.toBe('granted');

    expect(repository.grantRequest).toMatchObject({
      actorAdministratorId: 'actor-id', designatedAdministratorId: 'target-id', now,
      validUntil: new Date('2026-10-29T08:00:00.000Z'),
    });
  });

  it('treats an unavailable device or designated administrator as not found', async () => {
    const repository = new MemoryRepository();
    repository.grant = async () => false;
    const service = new TestAuthorizationService(repository);

    await expect(service.grant({
      actorAdministratorId: 'actor-id', deviceId: '19d7b60c-f258-4be3-8e5a-698670687843',
      designatedAdministratorId: 'target-id', now: new Date(),
    })).resolves.toBe('not_found');
  });
});
