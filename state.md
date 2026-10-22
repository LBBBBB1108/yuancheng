# yuancheng 项目状态

- 当前阶段：阶段 0 已实现，阶段 1 进行中
- 当前正式分支：`main`（本轮收尾完成后快进并推送）
- 阶段大纲：已拆分为可独立实现和验收的小阶段，详见 `docs/staged-roadmap.md`。
- 已完成：monorepo、锁定依赖、协议严格校验、PostgreSQL 初始迁移、管理员认证核心、一次性配对/登记核心、中文管理后台、Windows 欢迎页、Test/Production 构建、Ed25519+DPAPI 设备身份、设备 WebSocket 一次性挑战认证、心跳撤销检查、Windows 首次 HTTP 登记、后续自动连接、退避重连及本机停止/重新启用接线。
- 已验证：Node 35 项单元/API/WebSocket 测试；TypeScript 类型检查；前后端生产构建；Windows 核心自动测试；WPF Test 与 Production 零警告构建。
- 下一步：从小阶段 1.2“管理员初始化与完整会话”继续；随后依次完成 1.7 设备管理、1.8 七天测试授权、1.9 正式版确认状态机和 1.10 阶段 1 端到端验收。
- 阻塞项：本机仍缺少系统级 Node/npm、PostgreSQL 18/psql；使用了仓库内便携式 .NET 10 SDK。尚未运行真实 PostgreSQL 集成、Windows 双机、跨网络或 5 台并发实测。
- 部署状态：未创建或修改任何 Render 服务与付费资源。
- 当前边界：WPF 已接线自动登记和 WSS 连接循环，但尚未用真实 PostgreSQL/Render 做端到端运行，因此不能宣称“双击即上线”验收已经通过。
- 本轮收尾：只整理执行大纲和状态，不新增功能、不部署、不推送。
