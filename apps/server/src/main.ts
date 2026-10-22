import pg from 'pg';

import { buildApp } from './app.js';
import { AdminAuthService } from './auth/admin-auth-service.js';
import { PostgresAdminRepository } from './auth/postgres-admin-repository.js';
import { loadConfig } from './config.js';
import { PostgresDeviceRepository } from './devices/postgres-device-repository.js';
import { DeviceManagementService } from './devices/device-management-service.js';
import { DeviceAuthService } from './devices/device-auth-service.js';
import { TestAuthorizationService } from './devices/test-authorization-service.js';
import { ConsentRequestService } from './consent/consent-request-service.js';
import { EnrollmentService } from './enrollment/enrollment-service.js';
import { PairingService } from './enrollment/pairing-service.js';
import { PostgresEnrollmentRepository } from './enrollment/postgres-enrollment-repository.js';
import { PostgresPairingRepository } from './enrollment/postgres-pairing-repository.js';

const config = loadConfig(process.env);
const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ssl: config.nodeEnv === 'production' ? { rejectUnauthorized: true } : undefined,
});
const adminRepository = new PostgresAdminRepository(pool);
const deviceRepository = new PostgresDeviceRepository(pool);
const consentRequests = new ConsentRequestService(deviceRepository);
await consentRequests.endAllOpenOnStartup(new Date());
const app = await buildApp(config, {
  adminAuth: new AdminAuthService(adminRepository),
  devices: deviceRepository,
  deviceManagement: new DeviceManagementService(deviceRepository),
  testAuthorizations: new TestAuthorizationService(deviceRepository),
  pairing: new PairingService(
    new PostgresPairingRepository(pool),
    config.publicServerUrl,
  ),
  enrollment: new EnrollmentService(new PostgresEnrollmentRepository(pool)),
  deviceAuth: new DeviceAuthService(deviceRepository),
  consentRequests,
});

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, '正在关闭服务');
  await app.close();
  await pool.end();
  process.exit(0);
};

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ host: config.host, port: config.port });
