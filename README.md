# yuancheng

公司内部 Windows 远程协助系统。当前正在实施阶段 0/1：工程基础、管理员认证、一次性设备登记和 Windows 欢迎页。

## 项目结构

- `apps/agent-windows`：Windows 10/11 x64 WPF 客户端。
- `apps/admin-web`：React 管理后台。
- `apps/server`：Node.js REST/WebSocket 服务。
- `packages/protocol`：共享协议、消息白名单和版本。
- `migrations`：PostgreSQL 版本化迁移。
- `tests`：Windows 核心和后续跨组件测试。
- `docs`：需求、架构、安全与开发说明。

## 当前可运行内容

- 中文管理后台登录页；登录后只读取服务端实际返回的设备，不内置模拟设备。
- 服务端健康检查、管理员登录、会话 Cookie、CSRF 校验、设备权限列表、一次性登记描述和登记接口。
- PostgreSQL 初始迁移、迁移/回滚执行器、5 台设备上限的串行化登记事务。
- Windows 中文欢迎页、欢迎图选择与真实格式校验、停止/退出按钮。
- Windows Ed25519 独立设备身份，私钥使用当前 Windows 用户的 DPAPI 保护。
- Test/Production 独立编译配置，正式构建无法调用测试自动批准策略。

屏幕查看、输入控制、文件传输和 Render 部署尚未实现，详见 [state.md](state.md)。

## 本地准备

要求 Node.js 24、pnpm 11.25、.NET 10 SDK 和 PostgreSQL 18。复制 `.env.example` 为 `.env`，设置独立的开发数据库账号和至少 32 字符的会话密钥。

```powershell
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
pnpm db:migrate
```

启动服务端和后台：

```powershell
pnpm dev:server
pnpm dev:admin
```

Windows 客户端：

```powershell
dotnet restore Yuancheng.slnx --locked-mode
dotnet run --project tests/Agent.Core.Tests/Agent.Core.Tests.csproj
dotnet build apps/agent-windows/src/Yuancheng.Agent/Yuancheng.Agent.csproj --configuration Test --no-restore
dotnet build apps/agent-windows/src/Yuancheng.Agent/Yuancheng.Agent.csproj --configuration Production --no-restore
```

项目不要求管理员权限，不提供关闭证书验证、关闭杀毒软件或绕过 UAC 的步骤。
