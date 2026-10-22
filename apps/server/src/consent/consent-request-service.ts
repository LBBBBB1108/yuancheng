export const consentPermissions = ['view', 'control', 'files.upload', 'files.download'] as const;
export type ConsentPermission = typeof consentPermissions[number];
export type ConsentStatus = 'pending' | 'authorized' | 'rejected' | 'timed_out' | 'ended';

export interface ConsentRequest {
  id: string;
  administratorId: string;
  administratorDisplayName: string;
  deviceId: string;
  permissions: readonly ConsentPermission[];
  status: ConsentStatus;
  requestedAt: Date;
  expiresAt: Date;
}

export interface ConsentRequestRepository {
  createConsent(request: Omit<ConsentRequest, 'id' | 'status'>): Promise<{ status: 'created'; request: ConsentRequest } | { status: 'already_open' } | { status: 'not_found' }>;
  getConsent(requestId: string, administratorId: string, now: Date): Promise<ConsentRequest | null>;
  respond(request: { requestId: string; deviceId: string; accepted: boolean; now: Date }): Promise<'authorized' | 'rejected' | 'timed_out' | 'ended' | 'not_found'>;
  end(request: { requestId: string; administratorId: string; now: Date; reason: string }): Promise<'ended' | 'not_found' | 'terminal'>;
  expire(now: Date): Promise<void>;
  endOpenForDevice(deviceId: string, now: Date, reason: string): Promise<void>;
  endAllOpenOnStartup(now: Date): Promise<void>;
}

export class ConsentRequestService {
  public constructor(private readonly repository: ConsentRequestRepository) {}

  public async create(request: {
    administratorId: string; administratorDisplayName: string; administratorPermissions: readonly string[];
    deviceId: string; permissions: readonly string[]; now: Date;
  }) {
    if (!hasRequestedPermissions(request.administratorPermissions, request.permissions)) return { status: 'forbidden' as const };
    const permissions = request.permissions as ConsentPermission[];
    return this.repository.createConsent({
      administratorId: request.administratorId, administratorDisplayName: request.administratorDisplayName,
      deviceId: request.deviceId, permissions, requestedAt: request.now,
      expiresAt: new Date(request.now.getTime() + 60_000),
    });
  }

  public get(requestId: string, administratorId: string, now: Date) { return this.repository.getConsent(requestId, administratorId, now); }
  public respond(request: { requestId: string; deviceId: string; accepted: boolean; now: Date }) { return this.repository.respond(request); }
  public end(request: { requestId: string; administratorId: string; now: Date; reason: string }) { return this.repository.end(request); }
  public expire(now: Date) { return this.repository.expire(now); }
  public endOpenForDevice(deviceId: string, now: Date, reason: string) { return this.repository.endOpenForDevice(deviceId, now, reason); }
  public endAllOpenOnStartup(now: Date) { return this.repository.endAllOpenOnStartup(now); }
}

function hasRequestedPermissions(administratorPermissions: readonly string[], requested: readonly string[]): requested is ConsentPermission[] {
  if (!Array.isArray(requested) || requested.length === 0 || requested.length > consentPermissions.length || new Set(requested).size !== requested.length) return false;
  return requested.every((permission): permission is ConsentPermission => consentPermissions.includes(permission as ConsentPermission) && administratorPermissions.includes(permissionToAdministratorPermission(permission as ConsentPermission)));
}

function permissionToAdministratorPermission(permission: ConsentPermission): string {
  if (permission === 'view') return 'sessions.view';
  if (permission === 'control') return 'sessions.control';
  if (permission === 'files.upload') return 'files.upload';
  return 'files.download';
}
