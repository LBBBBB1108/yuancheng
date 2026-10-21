# 第三方依赖清单

版本核对日期：2026-10-21。所有直接 JavaScript 依赖均通过 `pnpm-lock.yaml` 固定完整依赖树。

| 依赖 | 固定版本 | 许可证 | 用途 |
|---|---:|---|---|
| TypeScript | 7.0.2 | Apache-2.0 | 类型检查和编译 |
| Vitest | 5.0.5 | MIT | Node 与前端测试 |
| tsx | 4.23.15 | MIT | 本地 TypeScript 运行 |
| TypeBox | 0.34.52 | MIT | 协议运行时校验 |
| Fastify | 5.12.7 | MIT | REST 服务 |
| @fastify/websocket | 11.3.4 | MIT | WebSocket 接入 |
| @fastify/cookie | 11.1.3 | MIT | 管理员会话 Cookie |
| @fastify/cors | 11.3.1 | MIT | 限定来源的跨域访问 |
| argon2 | 0.45.1 | MIT | Argon2id 密码哈希 |
| pg | 8.23.1 | MIT | PostgreSQL 驱动 |
| React / React DOM | 19.3.1 | MIT | 管理后台界面 |
| Vite | 8.3.5 | MIT | 管理后台构建 |
| React Testing Library | 16.3.3 | MIT | 前端行为测试 |
| NSec.Cryptography | 26.4.0 | MIT | Ed25519 设备身份 |
| System.Security.Cryptography.ProtectedData | 10.0.13 | MIT | Windows DPAPI 私钥保护 |

间接依赖及许可证以锁文件和 CI 生成的软件物料清单为准；引入新直接依赖前必须补充本表。
