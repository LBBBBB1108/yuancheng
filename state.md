# yuancheng 项目状态

- 当前阶段：阶段 0 已实现，阶段 1 进行中（1.2、1.7、1.8、1.9 已完成代码与 Node 自动验证）
- 当前正式分支：`main`（本轮收尾完成后快进并推送）
- 阶段大纲：已拆分为可独立实现和验收的小阶段，详见 `docs/staged-roadmap.md`。
- 已完成：monorepo、锁定依赖、协议严格校验、PostgreSQL 初始迁移、管理员认证核心、首管理员交互初始化、固定七天完整会话（恢复、轮换、退出与全部撤销）、一次性配对/登记核心、设备重命名、分组和撤销、七天测试授权、中文管理后台、Windows 欢迎页、Test/Production 构建、Ed25519+DPAPI 设备身份、设备 WebSocket 一次性挑战认证、心跳撤销检查、Windows 首次 HTTP 登记、后续自动连接、退避重连及本机停止/重新启用接线。
- 已验证：Node 50 项单元/API/WebSocket/后台测试；TypeScript 类型检查；前后端生产构建。Windows 核心自动测试与 WPF Test/Production 构建此前通过，但本轮本机缺少可用 .NET SDK，未复跑。
- 下一步：完成小阶段 1.9 的 Windows 实机构建与联调记录；随后完成 1.10 阶段 1 端到端验收。
- 阻塞项：本机仍缺少系统级 Node/npm、PostgreSQL 18/psql；使用了仓库内便携式 .NET 10 SDK。尚未运行真实 PostgreSQL 集成、Windows 双机、跨网络或 5 台并发实测。
- 部署状态：未创建或修改任何 Render 服务与付费资源。
- 当前边界：WPF 已接线自动登记和 WSS 连接循环，但尚未用真实 PostgreSQL/Render 做端到端运行，因此不能宣称“双击即上线”验收已经通过。
- 本轮收尾：1.9 已接通管理员请求、服务端严格协议与状态更新、Windows 本机确认窗口以及后台状态查询/结束操作。Node 自动测试（54 项）、类型检查和生产构建通过。本机没有可用 .NET SDK，Windows Core 测试和 Test/Production WPF 构建未执行；真实 PostgreSQL、在线 Windows、双机和跨网络验收未执行。未推送、未部署。
