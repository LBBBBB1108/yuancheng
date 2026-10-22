import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { App } from './App';

describe('App', () => {
  it('shows the Chinese administrator login without fake device data after session restoration fails', async () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: '公司远程协助管理后台' })).toBeVisible();
    expect(await screen.findByLabelText('用户名')).toBeVisible();
    expect(screen.getByLabelText('密码')).toBeVisible();
    expect(screen.getByRole('button', { name: '登录' })).toBeVisible();
    expect(screen.queryByText('测试电脑 1')).not.toBeInTheDocument();
  });

  it('restores an existing session before loading the administrator device list', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        admin: { id: 'admin-id', displayName: '测试管理员' }, permissions: ['devices.read'],
        expiresAt: '2026-10-28T08:00:00.000Z',
      }))
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'csrf-token' }))
      .mockResolvedValueOnce(jsonResponse({ devices: [] }));
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);

    expect(await screen.findByRole('heading', { name: '已授权设备' })).toBeVisible();
    expect(screen.getByRole('button', { name: '退出登录' })).toBeVisible();
    expect(screen.getByRole('button', { name: '退出所有登录' })).toBeVisible();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://localhost:10000/api/v1/auth/session',
      'http://localhost:10000/api/v1/auth/csrf',
      'http://localhost:10000/api/v1/devices',
    ]);
  });

  it('opens an authorized device editor after restoring the session', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ admin: { id: 'admin-id', displayName: '测试管理员' }, permissions: ['devices.read', 'devices.manage'], expiresAt: '2026-10-28T08:00:00.000Z' }))
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'csrf-token' }))
      .mockResolvedValueOnce(jsonResponse({ devices: [{
        id: '19d7b60c-f258-4be3-8e5a-698670687843', name: '财务测试机', groupName: '财务部',
        osVersion: 'Windows 11', clientVersion: '0.1.0-test', online: true, lastSeenAt: null,
      }] }));
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '编辑 财务测试机' }));

    expect(screen.getByLabelText('设备名称')).toHaveValue('财务测试机');
    expect(screen.getByLabelText('分组')).toHaveValue('财务部');
    expect(screen.getByRole('button', { name: '撤销设备' })).toBeVisible();
  });

  it('loads candidates and grants a selected administrator seven-day test authorization', async () => {
    const device = { id: '19d7b60c-f258-4be3-8e5a-698670687843', name: '财务测试机', groupName: null, osVersion: 'Windows 11', clientVersion: '0.1.0-test', online: true, lastSeenAt: null };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ admin: { id: 'admin-id', displayName: '测试管理员' }, permissions: ['devices.read', 'devices.manage'], expiresAt: '2026-10-28T08:00:00.000Z' }))
      .mockResolvedValueOnce(jsonResponse({ csrfToken: 'csrf-token' }))
      .mockResolvedValueOnce(jsonResponse({ devices: [device] }))
      .mockResolvedValueOnce(jsonResponse({ authorization: null, candidates: [{ id: '29d7b60c-f258-4be3-8e5a-698670687843', displayName: '指定管理员' }] }))
      .mockResolvedValueOnce(jsonResponse({}))
      .mockResolvedValueOnce(jsonResponse({ devices: [device] }));
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '编辑 财务测试机' }));
    expect(await screen.findByLabelText('测试授权管理员')).toBeVisible();
    fireEvent.change(screen.getByLabelText('测试授权管理员'), { target: { value: '29d7b60c-f258-4be3-8e5a-698670687843' } });
    fireEvent.click(screen.getByRole('button', { name: '授予/续期七天' }));
    expect(await screen.findByText('已更新测试授权。')).toBeVisible();
  });
});

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
}
