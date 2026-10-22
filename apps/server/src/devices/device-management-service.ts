export interface DeviceManagementRequest {
  administratorId: string;
  deviceId: string;
  name: string;
  groupName: string | null;
  now: Date;
}

export interface DeviceManagementRepository {
  update(request: DeviceManagementRequest): Promise<boolean>;
  revoke(request: { administratorId: string; deviceId: string; now: Date }): Promise<boolean>;
}

export class DeviceManagementService {
  public constructor(private readonly repository: DeviceManagementRepository) {}

  public async update(request: DeviceManagementRequest): Promise<'updated' | 'invalid' | 'not_found'> {
    const name = normalizeText(request.name);
    const groupName = request.groupName === null ? null : normalizeText(request.groupName);
    if (!name || (request.groupName !== null && !groupName)) return 'invalid';
    return await this.repository.update({ ...request, name, groupName }) ? 'updated' : 'not_found';
  }

  public async revoke(request: { administratorId: string; deviceId: string; now: Date }): Promise<'revoked' | 'not_found'> {
    return await this.repository.revoke(request) ? 'revoked' : 'not_found';
  }
}

function normalizeText(value: string): string | null {
  const normalized = value.trim();
  return normalized.length >= 1 && normalized.length <= 80 ? normalized : null;
}
