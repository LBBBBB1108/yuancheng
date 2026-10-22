const authorizationDurationMilliseconds = 7 * 24 * 60 * 60 * 1000;

export interface TestAuthorizationSummary {
  administratorId: string;
  displayName: string;
  validUntil: Date;
}

export interface TestAuthorizationCandidate {
  id: string;
  displayName: string;
}

export interface ActiveTestAuthorization {
  administratorId: string;
  validUntil: Date;
}

export interface TestAuthorizationRepository {
  get(request: { actorAdministratorId: string; deviceId: string; now: Date }): Promise<{
    authorization: TestAuthorizationSummary | null;
    candidates: TestAuthorizationCandidate[];
  } | null>;
  grant(request: {
    actorAdministratorId: string;
    deviceId: string;
    designatedAdministratorId: string;
    validUntil: Date;
    now: Date;
  }): Promise<boolean>;
  getActiveForDevice(deviceId: string, now: Date): Promise<ActiveTestAuthorization | null>;
}

export class TestAuthorizationService {
  public constructor(private readonly repository: TestAuthorizationRepository) {}

  public get(request: { actorAdministratorId: string; deviceId: string; now: Date }) {
    return this.repository.get(request);
  }

  public async grant(request: {
    actorAdministratorId: string;
    deviceId: string;
    designatedAdministratorId: string;
    now: Date;
  }): Promise<'granted' | 'not_found'> {
    const validUntil = new Date(request.now.getTime() + authorizationDurationMilliseconds);
    return await this.repository.grant({ ...request, validUntil }) ? 'granted' : 'not_found';
  }

  public getActiveForDevice(deviceId: string, now: Date): Promise<ActiveTestAuthorization | null> {
    return this.repository.getActiveForDevice(deviceId, now);
  }
}
