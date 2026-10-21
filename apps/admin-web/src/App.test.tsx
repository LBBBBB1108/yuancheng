import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from './App';

describe('App', () => {
  it('shows the Chinese administrator login without fake device data', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: '公司远程协助管理后台' })).toBeVisible();
    expect(screen.getByLabelText('用户名')).toBeVisible();
    expect(screen.getByLabelText('密码')).toBeVisible();
    expect(screen.getByRole('button', { name: '登录' })).toBeVisible();
    expect(screen.queryByText('测试电脑 1')).not.toBeInTheDocument();
  });
});
