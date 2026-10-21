export type DeploymentMode = 'test' | 'production';

export interface AppConfig {
  host: string;
  port: number;
  databaseUrl: string;
  adminWebOrigin: string;
  sessionSecret: string;
  publicServerUrl: string;
  deploymentMode: DeploymentMode;
  nodeEnv: string;
}

export function loadConfig(environment: Record<string, string | undefined>): AppConfig {
  const deploymentMode = environment.DEPLOYMENT_MODE;
  if (deploymentMode !== 'test' && deploymentMode !== 'production') {
    throw new Error('DEPLOYMENT_MODE 必须是 test 或 production');
  }

  const sessionSecret = requireValue(environment, 'SESSION_SECRET');
  if (sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET 至少需要 32 个字符');
  }

  const port = Number(environment.PORT ?? '10000');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT 必须是有效端口');
  }

  const adminWebOrigin = requireHttpUrl(environment, 'ADMIN_WEB_ORIGIN');
  const publicServerUrl = requireHttpUrl(environment, 'PUBLIC_SERVER_URL');

  return {
    host: environment.HOST ?? '0.0.0.0',
    port,
    databaseUrl: requireValue(environment, 'DATABASE_URL'),
    adminWebOrigin,
    sessionSecret,
    publicServerUrl,
    deploymentMode,
    nodeEnv: environment.NODE_ENV ?? 'development',
  };
}

function requireValue(
  environment: Record<string, string | undefined>,
  name: string,
): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(`${name} 未配置`);
  }
  return value;
}

function requireHttpUrl(
  environment: Record<string, string | undefined>,
  name: string,
): string {
  const value = requireValue(environment, name);
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${name} 必须使用 HTTP 或 HTTPS`);
  }
  return url.origin;
}
