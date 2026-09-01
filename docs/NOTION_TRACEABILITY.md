# Notion 架构追踪矩阵

本矩阵把 Notion 02–04 的强制约束映射到代码和验证证据。状态含义：`已实现`、`骨架已实现`、`待决策`、`发布阻断`。

| Notion 基线 | 实现位置 | 验证/状态 |
|---|---|---|
| React Native + TypeScript，iOS 首发 | `apps/mobile` | 类型检查通过；原生 host 待 Apple 参数，骨架已实现 |
| 原生媒体/后台能力不跨 JS 帧边界 | `apps/mobile/specs` | Codegen 规格已建立；原生实现发布阻断 |
| SQLite 先提交再更新 UI | `HybridScoreEventLog`、`ScoreSyncEngine` | Port/调用顺序已实现；iOS SQLite 发布阻断 |
| API + Realtime + Worker 三部署单元 | `apps/api`、`apps/realtime`、`apps/worker` | 已实现并可独立启动 |
| 模块化单体，不拆微服务/Kafka | `apps/api`、pnpm workspace | 已实现 |
| PostgreSQL 是服务端官方事实源 | `PostgresPlatformStore`、migration | 生产适配已实现；未连接/未执行 migration |
| Redis 只做可丢失加速 | `RedisScorePublisher/Subscriber` | 已实现；无持久业务写入 |
| Transactional outbox | `appendScoreTransaction`、`PostgresOutboxWorkerStore` | 同事务写入，SKIP LOCKED 消费；真实库集成测试待执行 |
| 不可变 ScoreEvent，可重建投影 | `packages/domain/src/scoring.ts` | 确定性重放/纠错测试通过 |
| schema/rules/stat 版本不匹配显式失败 | contracts、`ScoreService` | 版本不匹配测试通过；OfficialStatSet 仍为 draft |
| 每场单一官方记分员 | `ScorerAuthority`、`authority_epoch` | 显式交接/旧 epoch 隔离测试通过 |
| 幂等批量同步 | `(game, clientEventId)`、fingerprint | 重试和伪重复测试基础已实现 |
| canonical sequence 缺口恢复 | Realtime Gateway、snapshot/events API、`LiveScoreFollower` | 内存 API→WebSocket 端到端与客户端回源重放测试通过；真实 Redis 故障注入待完成 |
| 直播不阻断记分 | `VideoProvider` 与 ScoreService 分离 | 架构已实现；真机/蜂窝 Spike 待决策 |
| 托管视频、不自建转码/CDN | `VideoProvider` | Mock 仅开发；AWS IVS/Mux 待决策 |
| 后端签短时播放授权 | `PlaybackService` | Mock token 测试通过；供应商签名待实现 |
| 五类球队关系，Athlete 不是登录角色 | roles、migration、fixtures | Athlete login 永远 false，测试通过 |
| 默认私密、无匿名/公开分享 | `PolicyConfig`、配置启动 Gate | 强制 false，已实现 |
| 未设置年龄阈值不等于放开 | `ACCOUNT_MIN_AGE=null`、地区 Gate | 未知地区生产拒绝启动，已实现 |
| PilotGrant/Quota/Offer，无 StoreKit | QuotaLedger、offers endpoint | purchasable 恒 false，已实现 |
| 额度 append-only reservation | `QuotaLedger`、`quota_ledger` | 幂等/防超发单元测试通过 |
| 日志禁止敏感字段 | Fastify 默认字段、README 约束 | 需追加结构化 allowlist 审计，骨架已实现 |
| 合成测试数据，不复制儿童资料 | fixtures、GoldenGame draft | 已实现；教练签字待完成 |
| 5 倍峰值压测 | 环境配置与缺口清单 | 容量数值未给出，发布阻断 |
| PostgreSQL PITR 与对象引用演练 | migration/README | 未选择生产环境，发布阻断 |
| 无真实支付可达路径 | API/移动端无 StoreKit | 已实现 |

## 当前偏差处理

- 内存模式的 Realtime/Worker 使用 API 内部端点，目的仅是零依赖本地演示；生产模式明确切换到 PostgreSQL outbox 与 Redis Pub/Sub。
- 内存模式中的 EventLog 仅用于开发界面；iOS Release 必须提供 Native SQLite 实现，否则不能进入 TestFlight Gate。
- `golden-game-minimal.json` 明确标记 `companyCoachApproved=false`，任何统计字段都不能据此对外承诺。
