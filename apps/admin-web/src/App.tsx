import { type FormEvent, useEffect, useState } from 'react';

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

interface AdministratorSession {
  admin: { id: string; displayName: string };
  permissions: string[];
  expiresAt: string;
}
interface TestAuthorizationDetails {
  authorization: { administratorId: string; displayName: string; validUntil: string } | null;
  candidates: Array<{ id: string; displayName: string }>;
}
interface ConsentRequestSummary {
  id: string;
  status: 'pending' | 'authorized' | 'rejected' | 'timed_out' | 'ended';
  remoteFeaturesAvailable: boolean;
}

export function App() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [session, setSession] = useState<AdministratorSession | null | undefined>(undefined);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [devices, setDevices] = useState<DeviceSummary[] | null>(null);
  const [editingDevice, setEditingDevice] = useState<DeviceSummary | null>(null);
  const [deviceName, setDeviceName] = useState('');
  const [groupName, setGroupName] = useState('');
  const [confirmRevocation, setConfirmRevocation] = useState(false);
  const [testAuthorization, setTestAuthorization] = useState<TestAuthorizationDetails | null>(null);
  const [designatedAdministratorId, setDesignatedAdministratorId] = useState('');
  const [consentRequest, setConsentRequest] = useState<ConsentRequestSummary | null>(null);

  useEffect(() => {
    void restoreSession();
  }, []);

  useEffect(() => {
    if (!consentRequest || consentRequest.status !== 'pending') return;
    const timer = window.setInterval(() => { void refreshConsentRequest(consentRequest.id); }, 1_000);
    return () => window.clearInterval(timer);
  }, [consentRequest?.id, consentRequest?.status]);

  async function restoreSession() {
    try {
      const sessionResponse = await fetch(`${apiBaseUrl}/api/v1/auth/session`, { credentials: 'include' });
      if (sessionResponse.status === 401) {
        setSession(null);
        return;
      }
      if (!sessionResponse.ok) throw new Error('无法恢复登录状态');
      const currentSession = (await sessionResponse.json()) as AdministratorSession;
      const csrfResponse = await fetch(`${apiBaseUrl}/api/v1/auth/csrf`, { credentials: 'include' });
      if (!csrfResponse.ok) throw new Error('无法恢复请求校验');
      const { csrfToken: restoredCsrfToken } = await csrfResponse.json() as { csrfToken: string };
      setSession(currentSession);
      setCsrfToken(restoredCsrfToken);
      await loadDevices();
      const savedRequestId = sessionStorage.getItem('yc-consent-request');
      if (savedRequestId) await refreshConsentRequest(savedRequestId);
    } catch (reason) {
      setSession(null);
      setError(reason instanceof Error ? reason.message : '无法恢复登录状态');
    }
  }

  async function loadDevices() {
    const devicesResponse = await fetch(`${apiBaseUrl}/api/v1/devices`, { credentials: 'include' });
    if (devicesResponse.status === 401) {
      setSession(null);
      setCsrfToken(null);
      setDevices(null);
      throw new Error('登录已失效');
    }
    if (!devicesResponse.ok) throw new Error('无法读取设备列表');
    const payload = (await devicesResponse.json()) as { devices: DeviceSummary[] };
    setDevices(payload.devices);
  }

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

      const payload = await response.json() as { admin: { id: string; displayName: string }; csrfToken: string; expiresAt: string };
      setCsrfToken(payload.csrfToken);
      const sessionResponse = await fetch(`${apiBaseUrl}/api/v1/auth/session`, { credentials: 'include' });
      if (!sessionResponse.ok) throw new Error('无法读取登录权限');
      setSession((await sessionResponse.json()) as AdministratorSession);
      await loadDevices();
      setPassword('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '登录失败');
    } finally {
      setLoading(false);
    }
  }

  async function logout(allSessions: boolean) {
    if (!csrfToken) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/auth/${allSessions ? 'logout-all' : 'logout'}`, {
        method: 'POST', credentials: 'include', headers: { 'x-csrf-token': csrfToken },
      });
      if (!response.ok) throw new Error('退出登录失败，请重试');
      setSession(null);
      setCsrfToken(null);
      setDevices(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '退出登录失败，请重试');
    } finally {
      setLoading(false);
    }
  }

  async function beginEdit(device: DeviceSummary) {
    setEditingDevice(device);
    setDeviceName(device.name);
    setGroupName(device.groupName ?? '');
    setConfirmRevocation(false);
    setError('');
    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/devices/${device.id}/test-authorization`, { credentials: 'include' });
      if (!response.ok) throw new Error('无法读取测试授权');
      const details = await response.json() as TestAuthorizationDetails;
      setTestAuthorization(details);
      setDesignatedAdministratorId(details.authorization?.administratorId ?? details.candidates[0]?.id ?? '');
    } catch (reason) { setError(reason instanceof Error ? reason.message : '无法读取测试授权'); }
  }

  async function grantTestAuthorization() {
    if (!editingDevice || !csrfToken || !designatedAdministratorId) return;
    setLoading(true); setError('');
    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/devices/${editingDevice.id}/test-authorization`, {
        method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({ administratorId: designatedAdministratorId }),
      });
      if (!response.ok) throw new Error('更新测试授权失败，请重试');
      setError('已更新测试授权。');
      await loadDevices();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '更新测试授权失败，请重试'); }
    finally { setLoading(false); }
  }

  async function saveDevice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingDevice || !csrfToken) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/devices/${editingDevice.id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({ name: deviceName, groupName: groupName.trim() || null }),
      });
      if (!response.ok) throw new Error('保存设备设置失败，请重试');
      setEditingDevice(null);
      await loadDevices();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存设备设置失败，请重试');
    } finally {
      setLoading(false);
    }
  }

  async function revokeDevice() {
    if (!editingDevice || !csrfToken) return;
    if (!confirmRevocation) {
      setConfirmRevocation(true);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/devices/${editingDevice.id}`, {
        method: 'DELETE', credentials: 'include', headers: { 'x-csrf-token': csrfToken },
      });
      if (!response.ok) throw new Error('撤销设备失败，请重试');
      setEditingDevice(null);
      await loadDevices();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '撤销设备失败，请重试');
    } finally {
      setLoading(false);
    }
  }

  async function requestConsent(device: DeviceSummary) {
    if (!csrfToken) return;
    setLoading(true); setError('');
    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/devices/${device.id}/consent-requests`, {
        method: 'POST', credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({ permissions: ['view'] }),
      });
      if (!response.ok) throw new Error('无法发起确认请求，请检查设备是否在线。');
      const created = await response.json() as ConsentRequestSummary;
      sessionStorage.setItem('yc-consent-request', created.id);
      setConsentRequest(created);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '无法发起确认请求'); }
    finally { setLoading(false); }
  }

  async function refreshConsentRequest(requestId: string) {
    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/consent-requests/${requestId}`, { credentials: 'include' });
      if (response.status === 404) { sessionStorage.removeItem('yc-consent-request'); setConsentRequest(null); return; }
      if (!response.ok) return;
      const current = await response.json() as ConsentRequestSummary;
      setConsentRequest(current);
      if (current.status !== 'pending') sessionStorage.removeItem('yc-consent-request');
    } catch { /* polling failures keep the last verified server state visible */ }
  }

  async function endConsent() {
    if (!consentRequest || !csrfToken) return;
    setLoading(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/consent-requests/${consentRequest.id}/end`, {
        method: 'POST', credentials: 'include', headers: { 'x-csrf-token': csrfToken },
      });
      if (!response.ok) throw new Error('结束确认请求失败');
      sessionStorage.removeItem('yc-consent-request');
      setConsentRequest({ ...consentRequest, status: 'ended' });
    } catch (reason) { setError(reason instanceof Error ? reason.message : '结束确认请求失败'); }
    finally { setLoading(false); }
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

      {session === undefined ? (
        <section className="login-card"><p>正在恢复登录状态…</p></section>
      ) : session === null ? (
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
              <p>{session.admin.displayName}</p>
            </div>
            <div>
              <button disabled={loading} onClick={() => void logout(false)} type="button">退出登录</button>
              <button disabled={loading} onClick={() => void logout(true)} type="button">退出所有登录</button>
              <span>{devices?.length ?? 0} 台</span>
            </div>
          </div>
          {devices === null || devices.length === 0 ? (
            <p className="empty-state">尚未登记设备。请先生成一次性测试登记包。</p>
          ) : (
            <ul className="device-list">
              {devices.map((device) => (
                <li key={device.id}>
                  <div>
                    <strong>{device.name}</strong>
                    <span>{device.groupName ?? '未分组'} · {device.osVersion}</span>
                  </div>
                  <div className="device-actions">
                    <span className={device.online ? 'online' : 'offline'}>{device.online ? '在线' : '离线'}</span>
                    {session.permissions.includes('sessions.view') ? (
                      <button disabled={loading || !device.online || consentRequest?.status === 'pending'} onClick={() => void requestConsent(device)} type="button">请求确认 {device.name}</button>
                    ) : null}
                    {session.permissions.includes('devices.manage') ? (
                      <button onClick={() => void beginEdit(device)} type="button">编辑 {device.name}</button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {editingDevice ? (
            <form className="device-editor" onSubmit={saveDevice}>
              <h3>编辑设备</h3>
              <label>设备名称<input maxLength={80} onChange={(event) => setDeviceName(event.target.value)} required value={deviceName} /></label>
              <label>分组<input list="device-groups" maxLength={80} onChange={(event) => setGroupName(event.target.value)} value={groupName} /></label>
              <datalist id="device-groups">
                {[...new Set((devices ?? []).map((device) => device.groupName).filter((name): name is string => name !== null))].map((name) => <option key={name} value={name} />)}
              </datalist>
              {testAuthorization ? <>
                <label>测试授权管理员<select aria-label="测试授权管理员" disabled={loading} onChange={(event) => setDesignatedAdministratorId(event.target.value)} value={designatedAdministratorId}>
                  {testAuthorization.candidates.map((administrator) => <option key={administrator.id} value={administrator.id}>{administrator.displayName}</option>)}
                </select></label>
                {testAuthorization.authorization ? <p>当前授权：{testAuthorization.authorization.displayName}，至 {new Date(testAuthorization.authorization.validUntil).toLocaleString()}</p> : <p>尚未设置测试授权。</p>}
              </> : null}
              {error ? <p className="error" role="alert">{error}</p> : null}
              {confirmRevocation ? <p className="error">再次点击“撤销设备”将永久禁用当前设备身份。</p> : null}
              <div className="device-editor-actions">
                <button disabled={loading} type="submit">保存</button>
                <button disabled={loading} onClick={() => setGroupName('')} type="button">移至未分组</button>
                <button disabled={loading || !designatedAdministratorId} onClick={() => void grantTestAuthorization()} type="button">授予/续期七天</button>
                <button className="danger" disabled={loading} onClick={() => void revokeDevice()} type="button">撤销设备</button>
                <button disabled={loading} onClick={() => setEditingDevice(null)} type="button">取消</button>
              </div>
            </form>
          ) : null}
          {consentRequest ? (
            <section className="device-editor" aria-live="polite">
              {consentRequest.status === 'pending' ? <p>正在等待本机用户确认。远程功能尚未开放。</p> : null}
              {consentRequest.status === 'authorized' ? <p>本机用户已同意。远程功能尚未开放。</p> : null}
              {consentRequest.status === 'rejected' ? <p>本机用户已拒绝此请求。</p> : null}
              {consentRequest.status === 'timed_out' ? <p>确认请求已超时。</p> : null}
              {consentRequest.status === 'ended' ? <p>确认请求已结束。</p> : null}
              {consentRequest.status === 'pending' || consentRequest.status === 'authorized' ? <button disabled={loading} onClick={() => void endConsent()} type="button">结束确认请求</button> : null}
            </section>
          ) : null}
        </section>
      )}
    </main>
  );
}
