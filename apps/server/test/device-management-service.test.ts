import { describe, expect, it } from 'vitest';

import {
  DeviceManagementService,
  type DeviceManagementRepository,
} from '../src/devices/device-management-service.js';

class MemoryDeviceManagementRepository implements DeviceManagementRepository {
  public updateRequest: Parameters<DeviceManagementRepository['update']>[0] | undefined;

  async update(request: Parameters<DeviceManagementRepository['update']>[0]): Promise<boolean> {
    this.updateRequest = request;
    return true;
  }

  async revoke(): Promise<boolean> {
    return true;
  }
}

describe('DeviceManagementService', () => {
  it('normalizes an authorized device rename and new group before persistence', async () => {
    const repository = new MemoryDeviceManagementRepository();
    const service = new DeviceManagementService(repository);

    await expect(service.update({
      administratorId: 'admin-id', deviceId: '19d7b60c-f258-4be3-8e5a-698670687843',
      name: '  财务测试机  ', groupName: '  财务部  ', now: new Date('2026-10-22T08:00:00.000Z'),
    })).resolves.toBe('updated');
    expect(repository.updateRequest).toEqual({
      administratorId: 'admin-id', deviceId: '19d7b60c-f258-4be3-8e5a-698670687843',
      name: '财务测试机', groupName: '财务部', now: new Date('2026-10-22T08:00:00.000Z'),
    });
  });

  it('rejects an empty group name instead of treating it as ungrouped', async () => {
    const repository = new MemoryDeviceManagementRepository();
    const service = new DeviceManagementService(repository);

    await expect(service.update({
      administratorId: 'admin-id', deviceId: '19d7b60c-f258-4be3-8e5a-698670687843',
      name: '测试机', groupName: '   ', now: new Date(),
    })).resolves.toBe('invalid');
    expect(repository.updateRequest).toBeUndefined();
  });
});
