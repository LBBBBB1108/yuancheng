import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import pg from 'pg';

import { AdminBootstrapService } from './admin-bootstrap-service.js';
import { PostgresAdminRepository } from './postgres-admin-repository.js';
import { loadConfig } from '../config.js';

const readline = createInterface({ input, output, terminal: true });
try {
  const supplied = readSuppliedAdministrator();
  const request = supplied ?? await readInteractiveAdministrator();
  const config = loadConfig(process.env);
  const pool = new pg.Pool({ connectionString: config.databaseUrl, ssl: config.nodeEnv === 'production' ? { rejectUnauthorized: true } : undefined });
  try {
    const result = await new AdminBootstrapService(new PostgresAdminRepository(pool)).initialize(request);
    if (result === 'created') output.write('首管理员已创建。\n');
    else if (result === 'already_initialized') output.write('已有管理员，未作任何修改。\n');
    else throw new Error('用户名、显示名称或密码格式无效');
  } finally {
    await pool.end();
  }
} finally {
  readline.close();
}

function readSuppliedAdministrator(): { username: string; displayName: string; password: string } | undefined {
  const username = process.env.YUANCHENG_ADMIN_BOOTSTRAP_USERNAME;
  const displayName = process.env.YUANCHENG_ADMIN_BOOTSTRAP_DISPLAY_NAME;
  const password = process.env.YUANCHENG_ADMIN_BOOTSTRAP_PASSWORD;
  if (username === undefined && displayName === undefined && password === undefined) return undefined;
  if (username === undefined || displayName === undefined || password === undefined) {
    throw new Error('必须同时提供管理员用户名、显示名称和密码。');
  }
  return { username, displayName, password };
}

async function readInteractiveAdministrator(): Promise<{ username: string; displayName: string; password: string }> {
  const username = await readline.question('用户名: ');
  const displayName = await readline.question('显示名称: ');
  readline.close();
  const password = await readSecret('密码: ');
  const confirmation = await readSecret('确认密码: ');
  if (password !== confirmation) throw new Error('两次输入的密码不一致');
  return { username, displayName, password };
}

async function readSecret(prompt: string): Promise<string> {
  if (!input.isTTY || !input.setRawMode) throw new Error('管理员初始化必须在交互式终端中运行');
  output.write(prompt);
  input.setRawMode(true);
  input.resume();
  try {
    return await new Promise<string>((resolve, reject) => {
      let value = '';
      const onData = (chunk: Buffer) => {
        const character = chunk.toString('utf8');
        if (character === '\r' || character === '\n') {
          input.off('data', onData);
          output.write('\n');
          resolve(value);
        } else if (character === '\u0003') {
          input.off('data', onData);
          reject(new Error('管理员初始化已取消'));
        } else if (character === '\b' || character === '\u007f') {
          value = value.slice(0, -1);
        } else if (!character.includes('\u001b')) {
          value += character;
        }
      };
      input.on('data', onData);
    });
  } finally {
    input.setRawMode(false);
  }
}
