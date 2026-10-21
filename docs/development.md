# 开发环境

## 必需工具

- Node.js 24 LTS、pnpm 11.25。
- .NET 10 SDK x64。
- PostgreSQL 18 和 `psql`。
- Git 2.50 或更高版本。

本次工作使用仓库内临时 `.tools/dotnet` 验证，不会提交该目录。长期开发应安装系统级官方 .NET 10 SDK。

## 数据库

创建独立低权限账号和数据库后设置 `DATABASE_URL`。迁移命令只读取 `migrations/*.up.sql` 和对应的 `*.down.sql`，每个迁移在单独事务中执行并保存 SHA-256 校验值。

```powershell
pnpm db:migrate
pnpm db:rollback
```

当前机器尚未安装 PostgreSQL，因此真实数据库迁移和并发登记集成测试仍为阻塞项。

## 配置

秘密只放在未跟踪的 `.env` 或 Render Secret 环境变量中。前端的 `VITE_API_BASE_URL` 是公开地址，不能包含任何秘密。
