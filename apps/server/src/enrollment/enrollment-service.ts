import { createHash } from 'node:crypto';

export interface EnrollmentRequest {
  token: string;
  deviceName: string;
  publicKey: string;
  osVersion: string;
  clientVersion: string;
  now: Date;
}

export interface EnrollmentTransaction {
  tokenHash: string;
  deviceName: string;
  publicKey: string;
  osVersion: string;
  clientVersion: string;
  now: Date;
  maximumActiveDevices: 5;
}

export type EnrollmentResult =
  | { status: 'registered'; deviceId: string }
  | { status: 'invalid_token' | 'expired_token' | 'device_limit_reached' };

export interface EnrollmentRepository {
  enroll(transaction: EnrollmentTransaction): Promise<EnrollmentResult>;
}

export class EnrollmentService {
  public constructor(private readonly repository: EnrollmentRepository) {}

  public async enroll(request: EnrollmentRequest): Promise<EnrollmentResult> {
    validateToken(request.token);
    validateText(request.deviceName, '设备名称', 80);
    validateText(request.osVersion, '系统版本', 120);
    validateText(request.clientVersion, '客户端版本', 40);
    validatePublicKey(request.publicKey);

    return this.repository.enroll({
      tokenHash: createHash('sha256').update(request.token).digest('hex'),
      deviceName: request.deviceName.trim(),
      publicKey: request.publicKey,
      osVersion: request.osVersion.trim(),
      clientVersion: request.clientVersion.trim(),
      now: request.now,
      maximumActiveDevices: 5,
    });
  }
}

function validateToken(token: string): void {
  if (token.length < 24 || token.length > 256 || !/^[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error('登记令牌格式无效');
  }
}

function validateText(value: string, label: string, maximumLength: number): void {
  const length = value.trim().length;
  if (length < 1 || length > maximumLength) {
    throw new Error(`${label}格式无效`);
  }
}

function validatePublicKey(publicKey: string): void {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(publicKey)) {
    throw new Error('设备公钥格式无效');
  }

  const bytes = Buffer.from(publicKey, 'base64');
  if (bytes.length !== 32 || bytes.toString('base64') !== publicKey) {
    throw new Error('设备公钥格式无效');
  }
}
