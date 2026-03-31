# ws-gateway 技术方案

**WebSocket 推送网关架构设计文档**

> 版本：2.0 &nbsp;|&nbsp; 日期：2026-03-31

---

## 目录

1. [项目背景](#1-项目背景)
2. [整体架构](#2-整体架构)
3. [技术选型](#3-技术选型)
4. [核心模块设计](#4-核心模块设计)
5. [RabbitMQ Consistent Hash Exchange](#5-rabbitmq-consistent-hash-exchange)
6. [AWS 部署方案](#6-aws-部署方案)
7. [安全设计](#7-安全设计)
8. [监控与可观测性](#8-监控与可观测性)
9. [关键设计决策](#9-关键设计决策)
10. [已知限制与后续规划](#10-已知限制与后续规划)

---

## 1. 项目背景

`ws-gateway` 是一个高性能 WebSocket 推送网关，负责维持客户端长连接、管理订阅，并将来自后端（Java 服务）的推送消息实时下发给对应的在线连接。

### 核心设计原则

| # | 原则 |
|---|------|
| 1 | **网关不持有用户身份（userId）**，以 `authToken` 作为连接的唯一标识 |
| 2 | `authToken` 刷新时客户端主动重新建立 WebSocket 连接，网关无需感知 token 更新 |
| 3 | **不支持多 Tab / 多端同时登录**，1 个 `authToken` 对应 1 条 WebSocket 连接 |
| 4 | 消息路由完全由 **RabbitMQ Consistent Hash Exchange** 在 MQ 层完成，节点间无需通信 |
| 5 | **无 Redis 依赖**，架构极简 |

---

## 2. 整体架构

### 2.1 架构总览

```
┌──────────┐        WebSocket         ┌─────────────────────────────────────────┐
│  客户端   │ ─────────────────────── ▶│               ALB                       │
└──────────┘   Sticky Session Cookie  │   (WebSocket Upgrade + Sticky Session)  │
                                      └────────────────┬────────────────────────┘
                                                       │ 路由到同一节点
                                          ┌────────────▼────────────┐
                                          │   ws-gateway Node 1     │
                                          │   ws-gateway Node 2     │
                                          │   ws-gateway Node N     │
                                          │   (ECS EC2 Cluster)     │
                                          └────────────┬────────────┘
                                                       │ AMQP consume
                                          ┌────────────▼────────────┐
                                          │  RabbitMQ               │
                                          │  x-consistent-hash      │
                                          │  exchange               │
                                          │  ┌──────────────────┐   │
                                          │  │ ws.push.node-1   │   │
                                          │  │ ws.push.node-2   │   │
                                          │  │ ws.push.node-N   │   │
                                          │  └──────────────────┘   │
                                          └────────────▲────────────┘
                                                       │ publish (routing key = authToken)
                                          ┌────────────┴────────────┐
                                          │      Java 后端           │
                                          └─────────────────────────┘
```

### 2.2 组件职责

| 组件 | 职责 |
|------|------|
| **客户端** | WebSocket 连接，发送 `connection_init` / `subscribe` / `complete` 等协议消息 |
| **ALB** | WebSocket 升级 + Sticky Session（Cookie），确保同一 `authToken` 重连落在同一节点 |
| **ws-gateway (ECS EC2)** | 维持长连接，验证 token，管理订阅，消费 MQ 消息并下发 |
| **RabbitMQ (Amazon MQ)** | `x-consistent-hash` exchange，以 `authToken` 为 routing key 路由到 per-node 队列 |
| **Java 后端** | 产生推送事件，以 `authToken` 为 routing key 发布消息到 RabbitMQ exchange |

### 2.3 消息路由流程

```
Java 后端
  │
  │  publish(exchange="stake.topic", routingKey=authToken, body=message)
  ▼
RabbitMQ x-consistent-hash Exchange
  │
  │  hash(authToken) → 映射到对应节点的权重槽
  ├──▶ ws.push.node-1  (authToken A, C, E ...)
  ├──▶ ws.push.node-2  (authToken B, D, F ...)
  └──▶ ws.push.node-N  (authToken G, H, I ...)
              │
              │  consume
              ▼
        ws-gateway Node
              │
              ├── connections.get(authToken) 存在 → ws.send(message) ✓
              └── connections.get(authToken) 不存在 → 丢弃（用户离线）✗
```

---

## 3. 技术选型

| 技术 | 版本 | 用途 |
|------|------|------|
| **uWebSockets.js** | latest | 高性能 WebSocket 服务器（C++ 绑定，吞吐量远超 `ws` / `socket.io`） |
| **RabbitMQ** `x-consistent-hash` | 3.x | MQ 层一致性哈希路由，消除网关层路由复杂度 |
| **Amazon MQ for RabbitMQ** | — | 托管 RabbitMQ，免运维 |
| **Amazon ECS EC2** | t3/c5 系列 | 容器化部署，HOST 网络模式，低延迟 |
| **ALB** | — | WebSocket 代理，Sticky Session 保证重连路由稳定 |
| **TypeScript** | 5.x | 类型安全，提升可维护性 |
| **Node.js** | 18+ | 运行时 |

> **注意**：本方案不使用 Redis。历史版本中 Redis 用于用户节点映射和跨节点 Pub/Sub，现已完全由 RabbitMQ CH Exchange 替代，移除后架构更简洁、依赖更少。

---

## 4. 核心模块设计

### 4.1 认证模块（`auth`）

**WebSocket 连接认证流程：**

```
客户端                        ws-gateway                    Java 后端
  │                               │                              │
  │── WebSocket Upgrade ─────────▶│                              │
  │◀─ 101 Switching Protocols ────│                              │
  │                               │                              │
  │── connection_init ───────────▶│                              │
  │   { accessToken / lockdownToken }                            │
  │                               │── POST /token/validate ─────▶│
  │                               │   { accessToken: "xxx" }     │
  │                               │◀─ 200 OK / 401 ─────────────│
  │                               │                              │
  │◀─ connection_ack ─────────────│ (验证通过，注册连接)
  │   或                          │
  │◀─ close(4401 Unauthorized) ───│ (验证失败)
  │◀─ close(4400 Bad Request) ────│ (缺少 token)
```

- 握手（`upgrade`）阶段**不做认证**，等待客户端发送 `connection_init`
- 网关只关心验证通过/失败，**不解析 `userId`**，不持有用户身份
- `DEV_AUTH_BYPASS=true` 时跳过 HTTP 调用，直接通过（仅本地开发）

### 4.2 连接管理（`connection/manager`）

`Map<authToken, WebSocket>`，严格 1:1 映射（不支持多端）。

| 方法 | 说明 |
|------|------|
| `add(authToken, ws)` | 认证成功后注册连接 |
| `remove(authToken)` | 连接断开时清理 |
| `sendToSession(authToken, msg)` | 向指定连接推送消息 |
| `broadcast(msg)` | 广播给本节点所有连接 |
| `hasSession(authToken)` | 检查连接是否存在 |
| `size()` | 返回当前连接数 |

### 4.3 订阅管理（`subscription/manager`）

`Map<topic, Map<subscriptionId, WebSocket>>`，支持多连接订阅同一 topic。

- topic 白名单由 `SUPPORTED_TOPICS` 常量定义，非法 topic 拒绝订阅并返回 `error` 消息
- 连接断开时 `unsubscribeAll(ws)` 批量清理该连接的所有订阅

### 4.4 消息分发（`dispatcher`）

| `type` | 处理逻辑 |
|--------|---------|
| `session` | 按 `authToken` 查本地连接表，找到则推送，找不到则丢弃（CH Exchange 已保证路由正确） |
| `broadcast` | 广播给本节点所有连接（每个节点各消费一份） |
| `topic` | 推送给本节点订阅了该 topic 的所有连接（`next` 消息格式） |

纯内存操作，**无跨节点转发，无 Redis 依赖**。

### 4.5 MQ 消费（`mq/rabbitmq`）

**启动时 AMQP 初始化流程：**

```
assertExchange("stake.topic", "x-consistent-hash", { durable: true })
        ↓
assertQueue("ws.push.{nodeId}", { durable: true, "x-message-ttl": 30000 })
        ↓
bindQueue(queue, "stake.topic", routingKey: "10")   ← 权重字符串，所有节点相同
        ↓
channel.prefetch(100)                                ← 流控
        ↓
channel.consume(queue, handler)
```

**消费逻辑：**

```
接收消息
  │
  ├── JSON.parse 成功 → dispatch() → channel.ack()
  └── 解析失败 / 异常 → channel.nack(requeue=false)   ← 不重入队，防止死循环

连接断开 → 5 秒后自动重连
```

### 4.6 NODE_ID 解析（`bootstrap`）

每个节点需要唯一 ID 用于命名专属 MQ 队列。

**解析优先级：**

```
启动
  │
  ├─① process.env.NODE_ID 存在？
  │     └── YES → 使用该值（本地开发 / 手动指定）
  │
  ├─② ECS_CONTAINER_METADATA_URI_V4 存在？
  │     └── YES → GET .../task → TaskARN 末段
  │               arn:aws:ecs:...:task/cluster/abc123 → "abc123"
  │
  └─③ 兜底 → "node-{pid}"

将 NODE_ID 写入 process.env
  │
  └── require('./index')   ← config 模块此时才加载，可同步读取 NODE_ID
```

`bootstrap.ts` 是程序入口，确保 `dotenv.config()` 和 `NODE_ID` 解析都在 `config` 模块加载**之前**完成。

**ECS 节点完整生命周期：**

```
ECS Task 启动
     │
     ▼
bootstrap.ts
  dotenv.config()
  resolveNodeId()  →  NODE_ID = "abc123"
     │
     ▼
RabbitMQ 连接 & 队列初始化
  assertExchange / assertQueue / bindQueue
     │
     ▼
WebSocket 服务器监听 :3000
     │
     ▼
[正常服务中...]
     │
     ▼  收到 SIGTERM（ECS 缩容 / 滚动部署）
graceful shutdown
  mq.close()
     │
     ▼
process.exit(0)
     │
     ▼
队列中剩余消息 30s 后 TTL 自动过期丢弃
```

---

## 5. RabbitMQ Consistent Hash Exchange

### 5.1 路由原理

`x-consistent-hash` exchange 接收消息时，以消息的 **routing key** 计算哈希，路由到权重对应的队列。

```
routing key = authToken（由 Java 侧设置）

hash("eyJhbGci...") → slot 47  →  ws.push.node-2
hash("eyJhbGci...") → slot 83  →  ws.push.node-1
hash("eyJhbGci...") → slot 12  →  ws.push.node-2

所有节点绑定权重相同（"10"）→ RabbitMQ 均匀分配连接
```

**关键保证**：同一 `authToken` 的消息**始终**路由到同一节点队列，与该连接建立时 ALB Sticky Session 路由到的节点一致。

### 5.2 扩缩容行为

| 事件 | RabbitMQ 行为 | 影响 |
|------|--------------|------|
| **新节点上线** | `assertQueue` + `bindQueue` → 哈希环重新平衡 | 新 token 的连接自动路由到新节点，存量连接不受影响 |
| **节点正常下线** | `mq.close()` → 队列解绑（或保留直至 TTL） | 队列中积压消息 30s 后自动过期 |
| **节点异常宕机** | 队列仍存在，消息积压 | 30s TTL 后自动清理，不推送过期数据 |

### 5.3 本地开发配置

`docker-compose.yml` 中 rabbitmq 服务挂载插件配置：

```
rabbitmq/enabled_plugins:
[rabbitmq_management,rabbitmq_consistent_hash_exchange].
```

启动后：
- AMQP：`amqp://guest:guest@localhost:5672`
- 管理界面：`http://localhost:15672`（账号 `guest` / `guest`）

---

## 6. AWS 部署方案

### 6.1 资源规划

| 资源 | 规格 / 配置 | 说明 |
|------|------------|------|
| **ECS 集群** | EC2 Launch Type，`t3.medium` 起步 | 每台 EC2 运行一个 Task，HOST 网络模式 |
| **ALB** | WebSocket 支持，duration-based Sticky Session Cookie | 重连时路由到同一节点 |
| **Amazon MQ** | RabbitMQ，单节点（开发）/ 多可用区（生产） | 托管，免运维 |
| **IAM** | `ecsTaskExecutionRole` | 从 SSM Parameter Store 读取 `RABBITMQ_URL` 等敏感配置 |
| **Auto Scaling** | 基于 CPU 或连接数指标 | 扩容后新节点自动注册到 MQ exchange |

### 6.2 选用 ECS EC2 而非 Fargate 的原因

- `uWebSockets.js` 是 C++ native 模块，需要稳定的 OS 环境
- HOST 网络模式避免容器网络转发开销，连接延迟更低
- 可精确控制实例类型，更易做性能调优

### 6.3 部署流程

```
构建 Docker 镜像
     │
     ▼
推送到 ECR
     │
     ▼
更新 ECS Task Definition（新镜像 tag）
     │
     ▼
ECS Rolling Update
  新 Task 启动 → 健康检查通过 → ALB 注册
  旧 Task 收到 SIGTERM → graceful shutdown
     │
     ▼
完成，零停机
```

---

## 7. 安全设计

| 威胁 | 防护措施 |
|------|---------|
| 未认证连接长期占用 | `idleTimeout=60s`，超时未发 `connection_init` 则自动断开 |
| token 无效 | 返回 `4401` 关闭连接 |
| 缺少 token 参数 | 返回 `4400` 关闭连接 |
| 恶意 topic 订阅 | `SUPPORTED_TOPICS` 白名单校验，非法 topic 返回 `error` 消息 |
| 大包攻击 | `maxPayloadLength=16KB`，超限断开 |
| 内网通信暴露 | Java ↔ MQ 在 VPC 内网，MQ 不对公网开放 |
| 调试绕过认证 | `DEV_AUTH_BYPASS` 生产环境强制 `false`，通过环境变量控制 |

---

## 8. 监控与可观测性

### 8.1 健康检查接口

```
GET /health

Response:
{
  "status": "ok",
  "nodeId": "abc123",
  "connections": 1024,
  "subscriptions": 3187
}
```

ALB Target Group 健康检查指向 `/health`，节点异常时自动摘除流量。

### 8.2 关键指标

| 指标 | 来源 | 告警建议 |
|------|------|---------|
| 单节点连接数 | `/health` API | 超过阈值时触发扩容 |
| MQ 队列消息积压 | Amazon MQ CloudWatch Metrics | 持续积压超过阈值时告警 |
| TTL 丢弃消息数 | RabbitMQ Management API | 过多表示节点宕机时间过长 |
| token 验证错误率 | 应用日志 | 异常升高可能是攻击或 Java 鉴权服务故障 |
| WebSocket 连接建立延迟 | ALB Access Logs | P99 突增需排查 |

### 8.3 关键日志

```
[WS]         session initialized, total: 1024      ← 连接建立
[WS]         session disconnected (1001), total: 1023  ← 连接断开
[Dispatcher] session <token> not found, dropped    ← 连接不在本节点（偶发正常）
[RabbitMQ]   connection error: ECONNREFUSED        ← MQ 连接异常
[RabbitMQ]   reconnecting in 5s...                 ← 自动重连
[Auth]       validate token error: timeout         ← token 验证超时
```

---

## 9. 关键设计决策

| 决策点 | 选择 | 原因 |
|--------|------|------|
| **路由机制** | RabbitMQ CH Exchange | 无网关层哈希环，无 Redis，无跨节点 RPC，架构最简单可靠 |
| **用户标识** | `authToken`（不持有 `userId`） | 网关无需业务身份，降低数据暴露风险，职责单一 |
| **连接模型** | 1 `authToken` : 1 WebSocket | 业务约束（不支持多端），`Map` 比 `Map<Set>` 更简洁 |
| **Redis** | 完全移除 | CH Exchange 承担路由职责，用户节点映射和 Pub/Sub 均不再需要 |
| **NODE_ID 解析** | ECS Metadata 自动解析 | 无需手动注入环境变量，运维友好，本地开发有 `.env` 兜底 |
| **消息 TTL** | 30 秒 | 节点宕机 30s 内重启可无感切换；超出则丢弃，避免推送过期数据 |
| **ECS EC2 vs Fargate** | EC2 | native 模块兼容性 + HOST 网络低延迟 |

---

## 10. 已知限制与后续规划

| 限制 | 说明 | 可能的解决方案 |
|------|------|--------------|
| 无离线消息补偿 | 用户断线期间的消息直接丢弃 | 引入 offline message queue，重连后补推 |
| broadcast 去重 | topic 广播每个节点各消费一份，无幂等机制 | 引入消息 ID，消费前检查是否已处理 |
| ECS 缩容中断 | 缩容时若 drain 不完整，连接可能中断 | 配置 ALB deregistration delay，确保连接自然断开 |
| MQ 多可用区切换 | broker 主备切换期间 AMQP 连接短暂中断 | 确认重连逻辑（5s 延迟重试）可覆盖切换窗口 |

---

*文档由 ws-gateway 项目团队维护，如有问题请提交 Issue。*
