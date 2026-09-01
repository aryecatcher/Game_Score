# GameChanger 当前项目架构与实现状态

> 基线日期：2026-09-01。`✅` 表示代码已实现且具备本地验证证据；`🟡` 表示代码骨架存在但未完成真实集成；`🔴` 表示尚未实现；`⚪` 表示 P0 主动关闭。

## 总体架构

```mermaid
flowchart TB
  subgraph IOS["React Native iOS 客户端"]
    RN["🟡 React Native UI<br>记分员 / 获批球迷双角色入口已集成"]:::partial
    RULES["✅ TypeScript 领域规则<br>ScoreEvent / 权限 / 额度"]:::done
    SYNC["🟡 Sync Engine / LiveScoreFollower<br>内存链路与缺口恢复已验证；真机未验证"]:::partial
    LOCAL["🔴 Native SQLite WAL"]:::todo
    MEDIA["🔴 AVFoundation / AVPlayer / Keychain / APNs"]:::todo
    RN --> RULES
    RN --> SYNC
    RULES --> LOCAL --> SYNC
    RN --> MEDIA
  end

  subgraph SELF["自建部署单元"]
    API["✅ API 模块化单体<br>内存模式已验证"]:::done
    GATEWAY["🟡 Realtime Gateway<br>内存 API 集成已验证；Redis 待验证"]:::partial
    WORKER["🟡 Async Worker"]:::partial
  end

  subgraph DATA["数据与消息层"]
    PG["🟡 PostgreSQL<br>Schema/Adapter 已完成，Migration 未执行"]:::partial
    REDIS["🟡 Redis Pub/Sub<br>Adapter 已完成，未集成验证"]:::partial
    OBJECT["🔴 对象存储 / 录像"]:::todo
  end

  OIDC["🟡 OIDC<br>接口存在，供应商未接入"]:::partial
  VIDEO["🔴 AWS IVS / Mux<br>尚未选型"]:::todo
  STOREKIT["⚪ StoreKit<br>P0 禁用"]:::nongoal

  SYNC --> API
  API --> PG
  PG --> WORKER --> REDIS --> GATEWAY --> SYNC
  API --> VIDEO
  MEDIA --> VIDEO --> OBJECT
  OIDC --> API
  STOREKIT -.未来 Provider.-> API

  classDef done fill:#DCFCE7,stroke:#15803D,color:#14532D,stroke-width:2px;
  classDef partial fill:#FEF3C7,stroke:#D97706,color:#78350F,stroke-width:2px;
  classDef todo fill:#FEE2E2,stroke:#DC2626,color:#7F1D1D,stroke-width:2px;
  classDef nongoal fill:#F3F4F6,stroke:#6B7280,color:#374151,stroke-width:2px;
```

## 当前严格结论

- 已完成并验证：领域记分规则、权限/单写者、额度、核心内存 API、共享契约和模块化工程结构。
- 代码存在但未完成生产集成：React Native 记分员/获批球迷双入口、实时比分协调器和 Realtime Gateway 已通过内存端到端验证；Worker、PostgreSQL、Redis、OIDC 仍待专用环境集成。
- 尚未实现：iOS Native SQLite、媒体能力、真实视频、APNs、完整球队/观看/运营旅程及 TestFlight。
- P0 主动关闭：StoreKit 真实购买、公开分享、匿名观看和运动员自助登录。

## 验证证据

- `pnpm typecheck`：2026-09-01 通过。
- `pnpm test`：6 个测试文件、19 个测试全部通过。
- 内存端到端：API 接受官方记分事件后，受权 WebSocket 观看端收到相同 canonical sequence；序号缺口触发客户端回源重放。
- 未执行：数据库 Migration、Redis/PostgreSQL 集成、iOS 真机、真实视频、5 倍容量和 PITR 演练。

详细分层矩阵与进入 Alpha 的顺序见 Notion 子页面“03A｜当前项目架构与实现状态（2026-09-01）”。
