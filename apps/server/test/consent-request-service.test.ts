import { describe, expect, it } from 'vitest';

import { ConsentRequestService } from '../src/consent/consent-request-service.js';

const administratorId = '29d7b60c-f258-4be3-8e5a-698670687843';
const deviceId = '19d7b60c-f258-4be3-8e5a-698670687843';

describe('ConsentRequestService', () => {
  it('creates only permitted requests and fixes the sixty-second deadline', async () => {
    const calls: unknown[] = [];
    const service = new ConsentRequestService({
      createConsent: async (request) => { calls.push(request); return { status: 'created', request: { id: '39d7b60c-f258-4be3-8e5a-698670687843', administratorId, administratorDisplayName: '管理员', deviceId, permissions: ['view'] as const, status: 'pending' as const, requestedAt: request.now, expiresAt: request.expiresAt } }; },
      getConsent: async () => null,
      respond: async () => 'not_found',
      end: async () => 'not_found',
      expire: async () => undefined,
      endOpenForDevice: async () => undefined,
      endAllOpenOnStartup: async () => undefined,
    });
    const now = new Date('2026-10-22T08:00:00.000Z');
    const result = await service.create({ administratorId, administratorDisplayName: '管理员', administratorPermissions: ['sessions.view'], deviceId, permissions: ['view'], now });
    expect(result.status).toBe('created');
    expect(calls).toMatchObject([{ expiresAt: new Date('2026-10-22T08:01:00.000Z') }]);
    await expect(service.create({ administratorId, administratorDisplayName: '管理员', administratorPermissions: ['sessions.view'], deviceId, permissions: ['control'], now })).resolves.toEqual({ status: 'forbidden' });
  });

  it('does not accept a late response', async () => {
    const service = new ConsentRequestService({
      createConsent: async () => { throw new Error('unused'); }, getConsent: async () => null,
      respond: async () => 'timed_out', end: async () => 'not_found', expire: async () => undefined, endOpenForDevice: async () => undefined, endAllOpenOnStartup: async () => undefined,
    });
    await expect(service.respond({ requestId: '39d7b60c-f258-4be3-8e5a-698670687843', deviceId, accepted: true, now: new Date() })).resolves.toBe('timed_out');
  });
});
