import { createHash, randomBytes, randomUUID } from 'node:crypto';

export interface StoredPairingToken {
  id: string;
  tokenHash: string;
  requestedDeviceName: string;
  createdBy: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface PairingRepository {
  create(token: StoredPairingToken): Promise<void>;
}

export interface PairingDescriptor {
  formatVersion: 1;
  serverUrl: string;
  token: string;
  requestedDeviceName: string;
  expiresAt: string;
}

export class PairingService {
  public constructor(
    private readonly repository: PairingRepository,
    private readonly publicServerUrl: string,
  ) {}

  public async create(request: {
    requestedDeviceName: string;
    administratorId: string;
    now: Date;
  }): Promise<{ enrollment: PairingDescriptor; expiresAt: Date }> {
    const requestedDeviceName = request.requestedDeviceName.trim();
    if (requestedDeviceName.length < 1 || requestedDeviceName.length > 80) {
      throw new Error('设备名称格式无效');
    }

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(request.now.getTime() + 30 * 60 * 1000);
    await this.repository.create({
      id: randomUUID(),
      tokenHash: createHash('sha256').update(token).digest('hex'),
      requestedDeviceName,
      createdBy: request.administratorId,
      createdAt: request.now,
      expiresAt,
    });

    return {
      enrollment: {
        formatVersion: 1,
        serverUrl: this.publicServerUrl,
        token,
        requestedDeviceName,
        expiresAt: expiresAt.toISOString(),
      },
      expiresAt,
    };
  }
}
