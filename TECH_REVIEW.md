# WebSocket 推送网关 - 技术评审方案

> **项目**：ws-gateway
> **版本**：v2.2（main 分支）
> **日期**：2026-04-01
> **撰写**：前端团队
> **评审对象**：前端 Leader、后端 Leader

---

## 目录

1. [背景与目标](#1-背景与目标)
2. [整体架构](#2-整体架构)
3. [核心组件关系](#3-核心组件关系)
4. [关键流程图](#4-关键流程图)
5. [通信协议设计](#5-通信协议设计)
6. [性能设计](#6-性能设计)
7. [安全设计](#7-安全设计)
8. [高可用 & 容灾](#8-高可用--容灾)
9. [与 Java 后端集成规范](#9-与-java-后端集成规范)
10. [部署方案](#10-部署方案)
11. [常见问题 & 解决方案](#11-常见问题--解决方案)
12. [监控、可观测性与告警](#12-监控可观测性与告警)
13. [风险评估](#13-风险评估)
14. [总结与待确认事项](#14-总结与待确认事项)

---

## 1. 背景与目标

### 1.1 业务背景

平台（类 stake.com）需要支持大量用户的实时消息推送，覆盖以下场景：

| 类别 | 具体推送内容 |
|------|------------|
| **资金类** | 余额变动、充值到账、提现成功/失败/审核中 |
| **用户状态类** | KYC 审核通过/拒绝/待补充、账户状态变更、封禁通知 |
| **游戏类** | 游戏状态实时更新、高额投注记录、比赛状态 |
| **平台类** | 系统公告、功能标志变更 |
| **营销类** | 活动奖励发放、充值奖励交易 |

Java 后端团队资源紧张，由**前端团队独立开发并维护**此 WebSocket 推送网关，作为独立服务提供给 Java 后端调用。

当前架构明确只保留两类服务端消息：

- `user`：推给指定用户
- `topic`：推给主动订阅了某个主题的连接

不再提供默认 `broadcast`。这意味着“所有人都能收到”的公共消息，也必须先在客户端显式订阅对应 topic。

### 1.2 设计原则

| 原则 | 说明 |
|------|------|
| **独立部署** | 前端团队维护，不依赖 Java 内部模块 |
| **架构简单** | 职责单一：只负责 WebSocket 连接管理 + 消息推送 |
| **高并发** | 单节点支持数万并发 WebSocket 连接 |
| **高吞吐** | 支持每秒万级消息推送 |
| **水平扩展** | 节点无状态，按需弹性扩缩容 |
| **协议统一** | 服务端只保留 `user + topic` 两种推送语义 |
| **降低误发风险** | 无默认广播，客户端不订阅就收不到公共消息 |

### 1.3 技术选型

| 技术 | 选型 | 理由 |
|------|------|------|
| 运行时 | Node.js 20 + TypeScript | 异步 I/O 天然适合大量长连接管理 |
| WebSocket 库 | **uWebSockets.js v20** | C++ 底层实现，性能为原生 ws 的 10x+ |
| 集群协调 & 路由 | **Redis** | Pub/Sub 跨节点路由；用户-节点映射 |
| 认证 | HTTP 调用 Java 后端 | 认证逻辑保留在 Java 侧，网关无业务耦合 |
| 容器化 | Docker + ECS | 弹性伸缩，标准化部署 |

---

## 2. 整体架构

### 2.1 系统拓扑

```
┌─────────────────────────────────────────────────────────────────┐
│                         互联网 / 客户端                           │
└──────────────────────────────┬──────────────────────────────────┘
                               │ wss://
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                   AWS ALB（应用负载均衡器）                        │
│         /health → 健康检查    /ready → 优雅排水检查               │
└──────────┬──────────────────┬──────────────────┬────────────────┘
           │                  │                  │
           ▼                  ▼                  ▼
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│  ws-gateway  │   │  ws-gateway  │   │  ws-gateway  │
│   node-1     │   │   node-2     │   │   node-3     │
│              │   │              │   │              │
│ 连接管理      │   │ 连接管理      │   │ 连接管理      │
│ 消息分发      │   │ 消息分发      │   │ 消息分发      │
│ 订阅管理      │   │ 订阅管理      │   │ 订阅管理      │
└──────┬───────┘   └──────┬───────┘   └──────┬───────┘
       │                  │                  │
       └──────────────────┴──────────────────┘
                          │  3 类 Redis Key / Channel
                          ▼
              ┌────────────────────────────────┐
              │             Redis               │
              │                                 │
              │  ws:push:topic:{topic}         │ ← Topic 消息入口
              │  ws:route:{nodeId}             │ ← 用户定向消息 / 互踢
              │  ws:user_node:{userId}         │ ← 用户所在节点映射
              └───────────────┬─────────────────┘
                              │ HTTP（Token 验证）
                              ▼
                   ┌──────────────────────┐
                   │    Java 后端服务      │
                   │  • Token 验证接口    │
                   │  • 发布推送消息       │
                   └──────────────────────┘
```

### 2.2 节点内部架构

```
┌──────────────────────────────────────────────────────────────┐
│                      ws-gateway 单节点                         │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                  WebSocket Server (uWS.js)            │    │
│  │  /ws  /health  /ready                                │    │
│  └──────────────────────┬────────────────────────────────┘   │
│                         │ 连接事件                             │
│                         ▼                                     │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                   消息分发器 (Dispatcher)               │   │
│  │                                                        │   │
│  │  topic ingress     → 白名单校验 → 推送订阅者           │   │
│  │  route:{nodeId}    → 用户消息精准投递 / 互踢           │   │
│  └──────────┬────────────────────┬───────────────────────┘   │
│             ▼                    ▼                            │
│  ┌──────────────────┐  ┌──────────────────────┐             │
│  │ ConnectionManager│  │ SubscriptionManager  │             │
│  │  userId →        │  │  topic →             │             │
│  │    Set<WebSocket>│  │    {subId → WS}      │             │
│  └──────────────────┘  └──────────────────────┘             │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                  Redis 三连接层                         │   │
│  │  client            → SET/GET/DEL/SCAN/PUBLISH/EVAL    │   │
│  │  routeSubscriber   → SUBSCRIBE ws:route:{nodeId}      │   │
│  │  ingressSubscriber → PSUBSCRIBE ws:push:topic:*       │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. 核心组件关系

```
index.ts（启动编排）
    │
    ├── redis.connect()
    │     ├── cleanStaleUserNodes()
    │     ├── routeSubscriber → handleRouted()
    │     └── topicSubscriber → dispatchTopicIngress()
    │
    ├── createServer(state)
    │     │
    │     ├── /ws 连接事件
    │     │     ├── authenticateByToken() → Java HTTP
    │     │     ├── connection_init timeout / 订阅上限 / 互踢
    │     │     ├── connectionManager.add/remove
    │     │     ├── subscriptionManager.subscribe/unsubscribeAll
    │     │     └── redis.setUserNode / removeUserNodeIfOwner
    │     │
    │     └── /health /ready
    │
    └── 定时任务
          └── refreshOwnedUserNodes()
```

### 3.1 数据流向

| 方向 | 路径 | 说明 |
|------|------|------|
| 客户端 → 网关 | WebSocket | 认证、订阅、Ping |
| 网关 → 客户端 | WebSocket | next/ack/pong/错误关闭 |
| Java → 网关 | Redis PUBLISH `ws:push:topic:{topic}` | Topic 消息入口 |
| 网关 → Java | HTTP POST | Token 验证 |
| Java/节点 → 节点 | Redis PUBLISH `ws:route:{nodeId}` | 用户定向消息 / 互踢 |
| 节点 → Redis | SET/GET/DEL/SCAN/EVAL | 用户-节点映射维护与续期 |

---

## 4. 关键流程图

### 4.1 用户连接 & 认证

```
客户端                      ws-gateway                    Java 后端
   │                             │                             │
   │── WebSocket Upgrade ───────>│                             │
   │                             │                             │
   │── connection_init ─────────>│                             │
   │   { accessToken: "xxx" }    │── POST /token/validate ────>│
   │                             │<── { userId: "123" } ───────│
   │                             │  setUserNode("123")         │
   │                             │  close old session(if any)  │
   │                             │  connectionManager.add()    │
   │<── connection_ack ──────────│                             │
```

### 4.2 消息订阅 & 推送

```
客户端                              ws-gateway
   │── subscribe ───────────────────>│ 校验 topic 白名单
   │   { id:"s1", payload:"ws.notifications" }  subscriptionManager.subscribe()
   │
   │<── next ───────────────────────│ Java 发布 Topic 消息时推送
   │   { id:"s1", type:"next",      │
   │     payload:{ data:{...} } }   │
   │
   │── complete ───────────────────>│ subscriptionManager.unsubscribe()
   │   { id:"s1", type:"complete" } │
```

### 4.3 用户定向消息路由（当前实现）

```
Java 后端               Redis                    Gateway node-1（用户所在）
    │                    │                               │
    │── GET ws:user_node:u1 ────────────────>│          │
    │<── "node-1" ──────────────────────────│          │
    │── PUBLISH ws:route:node-1 ────────────>│─────────>│
    │   {type:"user", userId:"u1",...}       │   handleRouted()
    │                                        │   sendToUser("u1")
    │                                        │          │
    │                                        │          ▼
    │                                        │     WebSocket.send()
```

### 4.4 Topic 消息路由（当前实现）

```
Java 后端     Redis ws:push:topic:ws.announcements      所有 Gateway 节点
    │                          │                     node-1   node-2   node-3
    │── PUBLISH ───────────────>│                       │        │        │
    │  {type:"topic", ...}      │── 广播 ───────────────>│<───────│<───────│
    │                           │                  publish(topic,data)
    │                           │                       │        │        │
    │                           │                       ▼        ▼        ▼
    │                           │                仅推给本节点已订阅该 topic 的连接
```

### 4.5 优雅停机

```
ECS/运维                ws-gateway                      ALB
    │── SIGTERM ─────────>│  state.isDraining = true       │
    │                     │── /ready → 503 ───────────────>│
    │                     │  ALB 停止转发新连接              │
    │                     │  clear refresh timer            │
    │                     │  等待 shutdownGraceMs           │
    │                     │  redis.close()                  │
    │                     │  process.exit(0)                │
```

---

## 5. 通信协议设计

### 5.1 WebSocket 端点

```
wss://{domain}/ws
```

### 5.2 消息协议

#### 认证（连接后必须第一步）

```json
{ "type": "connection_init", "payload": { "accessToken": "eyJ..." } }
{ "type": "connection_ack" }
```

#### 订阅 / 取消订阅

```json
{ "id": "uuid", "type": "subscribe", "payload": "ws.available-balances" }
{ "id": "uuid", "type": "next", "payload": { "data": { ... } } }
{ "id": "uuid", "type": "complete" }
```

#### 心跳

```json
{ "type": "ping" }
{ "type": "pong" }
```

### 5.3 错误码

| Code | 说明 |
|------|------|
| `4400` | 格式错误 / 未认证前发送其他消息 / init 超时 |
| `4401` | Token 无效或过期 |
| `4409` | 同账号在其他节点登录，被互踢 |
| `1011` | 服务端内部错误 |

### 5.4 支持的 Topic（当前代码）

| Topic | 说明 |
|-------|------|
| `ws.available-balances` | 可用余额变动 |
| `ws.vault-balances` | 金库余额 |
| `ws.highroller-house-bets` | 高额投注记录 |
| `ws.announcements` | 系统公告 |
| `ws.race-status` | 比赛状态更新 |
| `ws.feature-flag` | 功能标志变更 |
| `ws.notifications` | 个人通知（通用） |
| `ws.house-bets` | 平台投注流 |
| `ws.deposit-bonus-transaction` | 充值奖励交易 |

---

## 6. 性能设计

### 6.1 连接容量估算

| 指标 | 数据 |
|------|------|
| 单节点并发连接（2 vCPU / 4 GB） | **~50,000** |
| 3 节点集群 | **~150,000** |
| 用户消息时延（精准路由） | Java 1 次 Redis GET + 1 次 PUBLISH，通常 1-3ms |
| Topic 消息时延 | Redis Pub/Sub + 本地推送，通常 < 5ms |

### 6.2 内存估算（单节点 50K 连接）

| 项目 | 估算 |
|------|------|
| WebSocket 连接（uWS 约 20KB/连接） | **~1 GB** |
| ConnectionManager Map | ~12 MB |
| SubscriptionManager Map | ~19 MB |
| 认证缓存（10 万条） | ~50 MB |
| Redis 三连接 | < 10 MB |
| **合计** | **~1.1 GB** |

### 6.3 Redis 操作模型

| 操作 | 当前模型 |
|------|-------|
| 用户消息 GET user_node | 1次（Java侧） |
| 用户消息 PUBLISH route | 1次（Java侧） |
| Topic Pub/Sub 分发 | 所有节点收到，但只推本地订阅者 |

---

## 7. 安全设计

### 7.1 认证机制

```
客户端建立连接
   │
   ├── 10s 内必须发送 connection_init
   ├── 优先查认证缓存
   ├── 缓存未命中 → HTTP 调 Java 验证
   ├── 验证通过 → 绑定 userId
   └── 验证失败 / 超时 → Close(4401)
```

### 7.2 Topic 白名单

- 订阅时校验 `SUPPORTED_TOPICS`
- 不在白名单 → 返回 `error` 消息并拒绝
- 防止枚举探测内部 topic

### 7.3 敏感消息约束

充值、提现、KYC 状态属于敏感金融信息，建议：

- WebSocket 只传事件和状态，不传金额详情
- 客户端收到后再调 REST API 获取详情
- 私有业务消息始终走 `user`，不能走公共 `topic`

### 7.4 传输安全

| 措施 | 说明 |
|------|------|
| TLS 终止在 ALB | 节点内明文，降低 CPU 消耗 |
| 强制 wss:// | ALB 仅开放 443 |
| VPC 内网 | Redis 不对公网暴露 |
| WAF | ALB + WAF 做连接频率限制 |

### 7.5 数据安全

- 网关不持久化任何业务数据
- Redis 仅存路由元数据（userId → nodeId）
- 消息在内存中流转，不落盘

---

## 8. 高可用 & 容灾

### 8.1 单节点故障

```
node-2 宕机：
  1. node-2 上的客户端 WebSocket 断连
  2. 客户端自动重连
  3. ALB 健康检查失败，摘除 node-2
  4. 客户端重连到 node-1/3，重新 connection_init
  5. redis.setUserNode 更新映射到新节点
```

### 8.2 Redis 故障降级

| 场景 | 降级行为 |
|------|---------|
| Redis 命令断开 | 新连接无法写入映射；跨节点路由失效 |
| Pub/Sub 断开 | 停止接收 topic/route 消息 |
| 恢复后 | ioredis 自动重连，重新订阅 |

### 8.3 Java 认证服务故障

| 场景 | 降级行为 |
|------|---------|
| 认证超时（> 3s） | 新连接失败（4401），存量连接正常 |
| 认证缓存命中 | 短时间内重连无需调 Java |

### 8.4 优雅停机

```
SIGTERM
  → state.isDraining = true
  → /ready 返回 503
  → 停止 user_node 续期定时器
  → 等待 shutdownGraceMs
  → redis.close()
  → process.exit(0)
```

---

## 9. 与 Java 后端集成规范

### 9.1 Java 需提供的接口

#### Token 验证接口

```
POST {AUTH_TOKEN_VALIDATE_URL}
Content-Type: application/json

{ "accessToken": "eyJ..." }
{ "lockdownToken": "guest-xxx" }

成功 (200): { "userId": "123456" }
失败: HTTP 401
```

### 9.2 Java 发布消息规范（当前实现）

#### Topic 消息

```bash
PUBLISH ws:push:topic:ws.announcements '{"type":"topic","topic":"ws.announcements","data":{...}}'
```

#### 用户定向消息

```bash
GET ws:user_node:{userId}
PUBLISH ws:route:{nodeId} '{"type":"user","userId":"123","event":"deposit_success","data":{...}}'
```

**Java 封装建议**（伪代码）：

```java
public void pushToUser(String userId, String event, Object data) {
    String nodeId = redis.get("ws:user_node:" + userId);
    if (nodeId == null) return;

    String message = json({type:"user", userId, event, data});
    redis.publish("ws:route:" + nodeId, message);
}

public void pushToTopic(String topic, Object data) {
    String message = json({type:"topic", topic, data});
    redis.publish("ws:push:topic:" + topic, message);
}
```

### 9.3 各业务场景消息格式

#### 充值到账

```json
{
  "type": "user",
  "userId": "123456",
  "event": "deposit_success",
  "data": {
    "transactionId": "txn-xxx",
    "status": "completed"
  }
}
```

#### 提现状态变更

```json
{
  "type": "user",
  "userId": "123456",
  "event": "withdrawal_status_changed",
  "data": {
    "transactionId": "txn-yyy",
    "status": "pending_review"
  }
}
```

#### 公共公告

```json
{
  "type": "topic",
  "topic": "ws.announcements",
  "data": {
    "message": "系统将于 22:00 维护",
    "level": "warning"
  }
}
```

### 9.4 Java 集成检查清单

- [ ] Token 验证接口地址、响应字段（`userId`）已确认
- [ ] `lockdownToken` 验证逻辑确认
- [ ] Redis 实例地址、密码、DB 已分配
- [ ] Java 侧封装 `pushToUser` / `pushToTopic` 工具方法
- [ ] 公共消息已经从旧 broadcast 模型迁移到 topic 模型
- [ ] 联调：充值、提现、公告三类消息端到端验证

---

## 10. 部署方案

### 10.1 环境变量

```env
PORT=3000
NODE_ID=

AUTH_TOKEN_VALIDATE_URL=http://java-backend:8080/internal/token/validate
AUTH_TIMEOUT_MS=3000
DEV_AUTH_BYPASS=false

REDIS_HOST=redis.internal
REDIS_PORT=6379
REDIS_PASSWORD=your-password
REDIS_DB=0
REDIS_TOPIC_CHANNEL_PREFIX=ws:push:topic:
REDIS_USER_NODE_TTL_SEC=7200
REDIS_USER_NODE_REFRESH_MS=3600000

WS_IDLE_TIMEOUT_SEC=120
WS_INIT_TIMEOUT_MS=10000
WS_MAX_SUBSCRIPTIONS=20
SHUTDOWN_GRACE_MS=30000
```

### 10.2 容器规格

| | 开发 | 生产最低 | 生产推荐 |
|--|------|---------|---------|
| CPU | 0.5 vCPU | 1 vCPU | 2 vCPU |
| 内存 | 512 MB | 2 GB | 4 GB |
| 节点数 | 1 | 2 | 3-5 |

### 10.3 ECS 关键配置

```yaml
healthCheck:
  command: ["CMD-SHELL", "curl -f http://localhost:3000/health || exit 1"]
  interval: 30
  timeout: 5
  retries: 3
stopTimeout: 35
```

### 10.4 本地开发

```bash
docker compose up redis -d
npm run dev

# 模拟 Java 发 topic
redis-cli PUBLISH ws:push:topic:ws.notifications '{"type":"topic","topic":"ws.notifications","data":{}}'

# 模拟 Java 发用户消息
redis-cli GET ws:user_node:123
redis-cli PUBLISH ws:route:node-1 '{"type":"user","userId":"123","event":"deposit_success","data":{}}'
```

---

## 11. 常见问题 & 解决方案

### 问题 1：公共消息没人收到

**优先排查**：

1. Java 是否发布到了正确的 `ws:push:topic:{topic}`
2. 客户端是否已经订阅了该 topic
3. 网关日志中是否执行了 `dispatchTopicIngress()`

---

### 问题 2：用户消息未收到

1. `GET ws:user_node:{userId}` 是否返回 nodeId
2. Java 是否把消息发布到了 `ws:route:{nodeId}`
3. 客户端连接是否已经完成 `connection_ack`

---

### 问题 3：节点宕机后短时间消息丢失

这是 WebSocket 在线推送的“尽力而为”语义，不提供离线补发。关键业务应配合 REST 拉取或其他离线渠道。

---

## 12. 监控、可观测性与告警

### 12.1 HTTP 端点

| 端点 | 用途 | 响应示例 |
|------|------|---------|
| `GET /health` | ALB 探针 | `{"status":"ok","redis":"ok","connections":42,"subscriptions":128}` |
| `GET /ready` | 停机排水 | 正常 200，停机中 503 |

### 12.2 关键指标

| 指标 | 告警阈值 |
|------|---------|
| `ws_connections_total` | 单节点 > 45K |
| `redis_healthy` | false 立即告警 |
| `auth_error_rate` | > 5% |
| `user_node_refresh_error_rate` | > 0 持续 5 分钟 |
| 容器内存 | > 80% |

### 12.3 推荐告警

监控不仅用于看板展示，也应配置主动告警。推荐接入 AWS CloudWatch Alarms + SNS，再转发到 Slack、飞书、邮件或值班系统。

| 告警项 | 触发条件 | 建议级别 |
|------|---------|---------|
| 网关实例不可用 | `/health` 连续失败或实例数低于阈值 | P0 |
| Redis 不可用 | `redis_healthy=false` 持续 1 分钟 | P0 |
| 鉴权失败率升高 | `auth_error_rate > 5%` 持续 5 分钟 | P1 |
| 鉴权超时升高 | Java 认证超时明显高于基线 | P1 |
| 在线连接数突降 | 短时间内连接数下降超过设定比例 | P1 |
| 异常断连升高 | `4401` / `1011` / 非预期 close code 激增 | P1 |
| user_node 续期异常 | `user_node_refresh_error_rate > 0` 持续 5 分钟 | P1 |
| Topic 流量异常 | 某个 topic 消息量或订阅数突然暴涨 | P2 |
| 资源压力过高 | CPU、内存、网络带宽持续高于阈值 | P2 |

### 12.4 日志规范

```text
[INFO]  user 123 connected, total=1024
[INFO]  user 123 disconnected (code=1000), total=1023
[WARN]  unsupported topic: ws.xxx
[DEBUG] routed message to user=123 on node=node-2
[ERROR] redis client error: ECONNREFUSED
```

---

## 13. 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| 客户端 topic 订阅策略未收敛 | 中 | 中 | 明确各端需要订阅的 topic 列表与时机 |
| Topic 扩展需发版 | 中 | 低 | 后续评估配置化 |
| Redis 单点故障 | 低 | 高 | ElastiCache 主从 + 自动 Failover |
| 长连接超过 TTL 后 user_node 失效 | 低 | 中 | 定时续期 + owner 校验刷新 |
| 前端团队承接 Node.js 服务运维 | 中 | 中 | 完善 Runbook + 监控告警 |

---

## 14. 总结与待确认事项

### 14.1 当前方案亮点

1. **协议统一**：只保留 `user + topic`
2. **高性能**：uWebSockets.js 单节点 5 万并发
3. **水平扩展**：节点无状态，加节点即扩容
4. **优雅停机**：`/ready` + `shutdownGraceMs`
5. **无默认广播**：客户端未订阅就不会收到公共消息

### 14.2 上线前需确认

| # | 项目 | 影响 |
|---|------|------|
| 1 | 客户端 topic 订阅策略已明确 | 否则公共消息可能因未订阅而漏收 |
| 2 | Java 已不再发送 broadcast 类型消息 | 旧消息将不被网关识别 |
| 3 | 公共消息对应的 topic 命名已收敛 | 避免前后端命名不一致 |

### 14.3 与 Java 后端待确认事项

- [ ] 确认 Java 侧不再发送 `broadcast`
- [ ] 确认客户端按协议显式订阅所需 topic
- [ ] 确认公共消息全部映射为 topic
- [ ] 确认 `lockdownToken` 是否也走 Java 验证
- [ ] 确认 event 名称和 data 字段约定

### 14.4 后续迭代计划

| 优先级 | 功能 |
|--------|------|
| P1 | 增加 Redis + WebSocket 端到端集成测试 |
| P2 | Topic 白名单配置化 |
| P2 | 结构化日志 + 请求追踪 ID |
| P3 | 断线重连消息补偿 |

---

*文档版本：v2.2 | 前端团队 | 如有问题请联系项目负责人*
