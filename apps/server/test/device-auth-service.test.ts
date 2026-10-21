import { generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  DeviceAuthService,
  type DeviceAuthRepository,
} from '../src/devices/device-auth-service.js';

const deviceId = '19d7b60c-f258-4be3-8e5a-698670687843';
const now = new Date('2026-10-22T08:00:00.000Z');

function createFixture(active = true) {
  const keys = generateKeyPairSync('ed25519');
  const publicKeyDer = keys.publicKey.export({ format: 'der', type: 'spki' });
  const publicKey = publicKeyDer.subarray(publicKeyDer.length - 32).toString('base64');
  const authentications: Array<Record<string, unknown>> = [];
  const heartbeats: Array<Record<string, unknown>> = [];
  const repository: DeviceAuthRepository = {
    findActiveCredential: async (id) =>
      active && id === deviceId ? { deviceId, publicKey } : null,
    recordAuthenticated: async (request) => {
      authentications.push(request);
      return true;
    },
    recordHeartbeat: async (id, seenAt) => {
      heartbeats.push({ deviceId: id, seenAt });
      return active;
    },
  };

  return {
    service: new DeviceAuthService(repository),
    privateKey: keys.privateKey,
    authentications,
    heartbeats,
  };
}

function signedResponse(
  challenge: { nonce: string },
  privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'],
) {
  return {
    deviceId,
    nonce: challenge.nonce,
    signature: sign(null, Buffer.from(challenge.nonce, 'base64url'), privateKey).toString(
      'base64',
    ),
    clientVersion: '0.1.0-test',
    osVersion: 'Windows 11 23H2',
  };
}

describe('DeviceAuthService', () => {
  it('authenticates an active device with a valid one-time Ed25519 challenge', async () => {
    const fixture = createFixture();
    const challenge = fixture.service.createChallenge(now);

    const result = await fixture.service.authenticate(
      signedResponse(challenge, fixture.privateKey),
      new Date(now.getTime() + 1_000),
    );

    expect(result).toEqual({ status: 'authenticated', deviceId });
    expect(fixture.authentications).toEqual([
      {
        deviceId,
        clientVersion: '0.1.0-test',
        osVersion: 'Windows 11 23H2',
        authenticatedAt: new Date(now.getTime() + 1_000),
      },
    ]);
  });

  it('rejects a signature made by another device key', async () => {
    const fixture = createFixture();
    const attacker = generateKeyPairSync('ed25519');
    const challenge = fixture.service.createChallenge(now);

    const result = await fixture.service.authenticate(
      signedResponse(challenge, attacker.privateKey),
      new Date(now.getTime() + 1_000),
    );

    expect(result).toEqual({ status: 'invalid_signature' });
    expect(fixture.authentications).toEqual([]);
  });

  it('consumes a challenge even when the first authentication fails', async () => {
    const fixture = createFixture();
    const attacker = generateKeyPairSync('ed25519');
    const challenge = fixture.service.createChallenge(now);

    await fixture.service.authenticate(
      signedResponse(challenge, attacker.privateKey),
      new Date(now.getTime() + 1_000),
    );
    const replay = await fixture.service.authenticate(
      signedResponse(challenge, fixture.privateKey),
      new Date(now.getTime() + 2_000),
    );

    expect(replay).toEqual({ status: 'invalid_challenge' });
    expect(fixture.authentications).toEqual([]);
  });

  it('rejects an expired challenge and an unknown or revoked device', async () => {
    const fixture = createFixture();
    const expiredChallenge = fixture.service.createChallenge(now);
    const expired = await fixture.service.authenticate(
      signedResponse(expiredChallenge, fixture.privateKey),
      new Date(now.getTime() + 15_001),
    );
    expect(expired).toEqual({ status: 'expired_challenge' });

    const revokedFixture = createFixture(false);
    const revokedChallenge = revokedFixture.service.createChallenge(now);
    const revoked = await revokedFixture.service.authenticate(
      signedResponse(revokedChallenge, revokedFixture.privateKey),
      new Date(now.getTime() + 1_000),
    );
    expect(revoked).toEqual({ status: 'device_not_found' });
    expect(revokedFixture.authentications).toEqual([]);
  });

  it('rejects a device revoked between signature verification and presence update', async () => {
    const keys = generateKeyPairSync('ed25519');
    const publicKeyDer = keys.publicKey.export({ format: 'der', type: 'spki' });
    const service = new DeviceAuthService({
      findActiveCredential: async () => ({
        deviceId,
        publicKey: publicKeyDer.subarray(publicKeyDer.length - 32).toString('base64'),
      }),
      recordAuthenticated: async () => false,
      recordHeartbeat: async () => false,
    });
    const challenge = service.createChallenge(now);

    const result = await service.authenticate(
      signedResponse(challenge, keys.privateKey),
      new Date(now.getTime() + 1_000),
    );

    expect(result).toEqual({ status: 'device_not_found' });
  });

  it('records heartbeats only while the device remains active', async () => {
    const fixture = createFixture();
    const seenAt = new Date(now.getTime() + 20_000);

    await expect(fixture.service.recordHeartbeat(deviceId, seenAt)).resolves.toBe(true);
    expect(fixture.heartbeats).toEqual([{ deviceId, seenAt }]);

    const revokedFixture = createFixture(false);
    await expect(revokedFixture.service.recordHeartbeat(deviceId, seenAt)).resolves.toBe(false);
  });
});
