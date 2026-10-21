import { type FormEvent, useState } from 'react';

import './styles.css';

const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:10000';

interface DeviceSummary {
  id: string;
  name: string;
  groupName: string | null;
  osVersion: string;
  clientVersion: string;
  online: boolean;
  lastSeenAt: string | null;
}

export function App() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [devices, setDevices] = useState<DeviceSummary[] | null>(null);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!response.ok) {
        throw new Error('用户名或密码错误');
      }

      const devicesResponse = await fetch(`${apiBaseUrl}/api/v1/devices`, {
        credentials: 'include',
      });
      if (!devicesResponse.ok) {
        throw new Error('无法读取设备列表');
      }
      const payload = (await devicesResponse.json()) as { devices: DeviceSummary[] };
      setDevices(payload.devices);
      setPassword('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '登录失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="shell">
      <header className="masthead">
        <div>
          <span className="eyebrow">YUANCHENG · 内部系统</span>
          <h1>公司远程协助管理后台</h1>
        </div>
        <span className="environment">测试环境</span>
      </header>

      {devices === null ? (
        <section className="login-card" aria-labelledby="login-title">
          <div>
            <p className="section-kicker">管理员验证</p>
            <h2 id="login-title">登录后管理已授权设备</h2>
            <p className="supporting-copy">设备画面、控制和文件权限均由服务端逐项校验。</p>
          </div>
          <form onSubmit={handleLogin}>
            <label>
              用户名
              <input
                autoComplete="username"
                maxLength={80}
                onChange={(event) => setUsername(event.target.value)}
                required
                value={username}
              />
            </label>
            <label>
              密码
              <input
                autoComplete="current-password"
                maxLength={256}
                onChange={(event) => setPassword(event.target.value)}
                required
                type="password"
                value={password}
              />
            </label>
            {error ? <p className="error" role="alert">{error}</p> : null}
            <button disabled={loading} type="submit">
              {loading ? '正在登录…' : '登录'}
            </button>
          </form>
        </section>
      ) : (
        <section className="device-panel" aria-labelledby="devices-title">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">设备</p>
              <h2 id="devices-title">已授权设备</h2>
            </div>
            <span>{devices.length} 台</span>
          </div>
          {devices.length === 0 ? (
            <p className="empty-state">尚未登记设备。请先生成一次性测试登记包。</p>
          ) : (
            <ul className="device-list">
              {devices.map((device) => (
                <li key={device.id}>
                  <div>
                    <strong>{device.name}</strong>
                    <span>{device.groupName ?? '未分组'} · {device.osVersion}</span>
                  </div>
                  <span className={device.online ? 'online' : 'offline'}>
                    {device.online ? '在线' : '离线'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}
