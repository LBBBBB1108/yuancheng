# yuancheng 项目状态

- 当前阶段：阶段 0 已实现，阶段 1 进行中
- 当前分支：`codex/stage-0-foundation`
- 已完成：monorepo、锁定依赖、协议严格校验、PostgreSQL 初始迁移、管理员认证核心、一次性配对/登记核心、中文管理后台、Windows 欢迎页、Test/Production 构建、Ed25519+DPAPI 设备身份核心、设备 WebSocket 一次性挑战认证、心跳撤销检查、Windows 登记描述严格校验和首次 HTTP 登记核心。
- 已验证：Node 35 项单元/API/WebSocket 测试；TypeScript 类型检查；前后端生产构建；Windows 核心自动测试；WPF Test 与 Production 零警告构建。
- 下一步：把登记与 WebSocket 客户端接入 WPF 启动/停止生命周期，补管理员初始化命令、离线检测与 7 天测试授权；随后进入真实屏幕阶段。
- 阻塞项：本机仍缺少系统级 Node/npm、PostgreSQL 18/psql；使用了仓库内便携式 .NET 10 SDK。尚未运行真实 PostgreSQL 集成、Windows 双机、跨网络或 5 台并发实测。
- 部署状态：未创建或修改任何 Render 服务与付费资源。
- 当前边界：服务端挑战认证和心跳撤销已可运行，但 WPF 窗口尚未接线到自动登记/连接循环，不能宣称“双击即上线”已经完成。
