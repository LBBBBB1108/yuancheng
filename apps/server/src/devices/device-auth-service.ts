import { createPublicKey, randomBytes, verify } from 'node:crypto';

const challengeLifetimeMilliseconds = 15_000;
const ed25519SubjectPublicKeyInfoPrefix = Buffer.from('302a300506032b6570032100', 'hex');

export interface ActiveDeviceCredential {
  deviceId: string;
  publicKey: string;
}

export interface RecordAuthenticationRequest {
  deviceId: string;
  clientVersion: string;
  osVersion: string;
  authenticatedAt: Date;
}

export interface DeviceAuthRepository {
  findActiveCredential(deviceId: string): Promise<ActiveDeviceCredential | null>;
  recordAuthenticated(request: RecordAuthenticationRequest): Promise<boolean>;
  recordHeartbeat(deviceId: string, seenAt: Date): Promise<boolean>;
}

export interface DeviceAuthResponse {
  deviceId: string;
  nonce: string;
  signature: string;
  clientVersion: string;
  osVersion: string;
}

export type DeviceAuthResult =
  | { status: 'authenticated'; deviceId: string }
  | {
      status:
        | 'invalid_challenge'
        | 'expired_challenge'
        | 'device_not_found'
        | 'invalid_signature';
    };

export class DeviceAuthService {
  private readonly challenges = new Map<string, number>();

  public constructor(private readonly repository: DeviceAuthRepository) {}

  public createChallenge(now: Date): { nonce: string; expiresAt: Date } {
    this.removeExpiredChallenges(now.getTime());
    const nonce = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + challengeLifetimeMilliseconds);
    this.challenges.set(nonce, expiresAt.getTime());
    return { nonce, expiresAt };
  }

  public async authenticate(
    response: DeviceAuthResponse,
    now: Date,
  ): Promise<DeviceAuthResult> {
    const expiresAt = this.challenges.get(response.nonce);
    if (expiresAt === undefined) return { status: 'invalid_challenge' };

    this.challenges.delete(response.nonce);
    if (now.getTime() > expiresAt) return { status: 'expired_challenge' };

    const credential = await this.repository.findActiveCredential(response.deviceId);
    if (!credential) return { status: 'device_not_found' };

    if (!isValidSignature(response, credential.publicKey)) {
      return { status: 'invalid_signature' };
    }

    const stillActive = await this.repository.recordAuthenticated({
      deviceId: credential.deviceId,
      clientVersion: response.clientVersion,
      osVersion: response.osVersion,
      authenticatedAt: now,
    });
    if (!stillActive) return { status: 'device_not_found' };
    return { status: 'authenticated', deviceId: credential.deviceId };
  }

  public recordHeartbeat(deviceId: string, seenAt: Date): Promise<boolean> {
    return this.repository.recordHeartbeat(deviceId, seenAt);
  }

  private removeExpiredChallenges(nowMilliseconds: number): void {
    for (const [nonce, expiresAt] of this.challenges) {
      if (expiresAt < nowMilliseconds) this.challenges.delete(nonce);
    }
  }
}

function isValidSignature(response: DeviceAuthResponse, encodedPublicKey: string): boolean {
  try {
    const publicKeyBytes = Buffer.from(encodedPublicKey, 'base64');
    const signature = Buffer.from(response.signature, 'base64');
    const challenge = Buffer.from(response.nonce, 'base64url');
    if (publicKeyBytes.length !== 32 || signature.length !== 64 || challenge.length !== 32) {
      return false;
    }

    const publicKey = createPublicKey({
      key: Buffer.concat([ed25519SubjectPublicKeyInfoPrefix, publicKeyBytes]),
      format: 'der',
      type: 'spki',
    });
    return verify(null, challenge, publicKey, signature);
  } catch {
    return false;
  }
}
