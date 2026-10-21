# yuancheng 项目状态

- 当前阶段：阶段 0 已实现，阶段 1 进行中
- 当前分支：`codex/stage-0-foundation`
- 已完成：monorepo、锁定依赖、协议严格校验、PostgreSQL 初始迁移、管理员认证核心、一次性配对/登记核心、中文管理后台、Windows 欢迎页、Test/Production 构建、Ed25519+DPAPI 设备身份、设备 WebSocket 一次性挑战认证、心跳撤销检查、Windows 首次 HTTP 登记、后续自动连接、退避重连及本机停止/重新启用接线。
- 已验证：Node 35 项单元/API/WebSocket 测试；TypeScript 类型检查；前后端生产构建；Windows 核心自动测试；WPF Test 与 Production 零警告构建。
- 下一步：补管理员初始化命令、设备撤销接口、服务端心跳超时与 7 天测试授权；安装 PostgreSQL 后运行真实迁移和端到端上线验证，再进入真实屏幕阶段。
- 阻塞项：本机仍缺少系统级 Node/npm、PostgreSQL 18/psql；使用了仓库内便携式 .NET 10 SDK。尚未运行真实 PostgreSQL 集成、Windows 双机、跨网络或 5 台并发实测。
- 部署状态：未创建或修改任何 Render 服务与付费资源。
- 当前边界：WPF 已接线自动登记和 WSS 连接循环，但尚未用真实 PostgreSQL/Render 做端到端运行，因此不能宣称“双击即上线”验收已经通过。
