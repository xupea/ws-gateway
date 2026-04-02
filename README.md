# ws-gateway

基于 Node.js + uWebSockets.js 实现的高性能 WebSocket 推送网关，支持横向扩展。

当前协议只保留两类服务端消息：

- `user`：推给指定用户
- `topic`：推给主动订阅了某个 topic 的连接

不再提供默认 `broadcast`。客户端必须在连接建立后，显式订阅自己关心的 topic。

## 架构

```
Java 服务端
    │
    │  发布消息（Redis Pub/Sub）
    ▼
┌─────────────────────────────────────────┐
│                Redis                    │
│   ws:push:topic:{topic}   ws:route:*    │
└────────────┬────────────────────────────┘
             │
    ┌────────┼────────┐
    ▼        ▼        ▼
  Node1    Node2    Node3      ← 多节点横向扩展
    │        │        │
    │        │        └── 各自维护本机连接和订阅
    │        │
    └────────┼────────┘
             │
             ▼
      ws:user_node:{userId}
      （记录 userId → nodeId）
```

**消息路由逻辑：**

1. 用户连接成功后，Redis 记录 `userId -> nodeId`
2. Java 发布 `user` 消息前，先查 `ws:user_node:{userId}`，再精准发布到 `ws:route:{nodeId}`
3. Java 发布 `topic` 消息时，直接发到 `ws:push:topic:{topic}`
4. 所有节点都会收到 topic 消息，但只推给本机上订阅了该 topic 的连接

## 技术栈

| 模块 | 选型 |
|------|------|
| WebSocket 服务器 | uWebSockets.js |
| 消息入口 | Redis Pub/Sub（ioredis） |
| 节点路由 | Redis Pub/Sub（ioredis） |
| 语言 | TypeScript |

## 目录结构

```
ws-gateway/
├── src/
│   ├── types/index.ts
│   ├── config/index.ts
│   ├── redis/index.ts
│   ├── auth/index.ts
│   ├── connection/manager.ts
│   ├── subscription/manager.ts
│   ├── dispatcher/index.ts
│   ├── ws/server.ts
│   └── index.ts
├── demo/
├── test/
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

## 环境变量

复制 `.env.example` 为 `.env` 并按需修改：

```bash
cp .env.example .env
```

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3000` | 监听端口 |
| `NODE_ID` | `node-{pid}` | 节点唯一标识，多节点部署时必须各不相同 |
| `WS_IDLE_TIMEOUT_SEC` | `120` | WebSocket 空闲超时（秒） |
| `WS_INIT_TIMEOUT_MS` | `10000` | 建连后等待 `connection_init` 的最长时间 |
| `WS_MAX_SUBSCRIPTIONS` | `20` | 单连接允许的最大订阅数 |
| `SHUTDOWN_GRACE_MS` | `10000` | 收到退出信号后的优雅停机等待时间（毫秒） |
| `AUTH_VALIDATE_URL` | `http://localhost:8080/internal/session/validate` | Java 认证接口地址（保留备用，Cookie 方式） |
| `AUTH_TOKEN_VALIDATE_URL` | `http://localhost:8080/internal/token/validate` | 推荐的 Java 认证接口地址（`connection_init` 方式） |
| `SESSION_COOKIE_NAME` | `session` | Session Cookie 名称 |
| `AUTH_TIMEOUT_MS` | `3000` | 认证请求超时（ms） |
| `DEV_AUTH_BYPASS` | `false` | 仅开发用，跳过认证，直接用 token 作为 userId |
| `REDIS_HOST` | `127.0.0.1` | Redis 地址 |
| `REDIS_PORT` | `6379` | Redis 端口 |
| `REDIS_PASSWORD` | — | Redis 密码（可选） |
| `REDIS_DB` | `0` | Redis 数据库编号 |
| `REDIS_TOPIC_CHANNEL_PREFIX` | `ws:push:topic:` | Topic 消息 channel 前缀 |
| `REDIS_USER_NODE_TTL_SEC` | `7200` | `userId -> nodeId` 映射 TTL（秒） |
| `REDIS_USER_NODE_REFRESH_MS` | `3600000` | 在线映射续期周期（毫秒） |

## 本地开发

### 前置条件

- Node.js 20+
- Docker（用于启动 Redis）

### 启动

**1. 安装依赖**

```bash
npm install
```

**2. 启动 Redis**

```bash
docker compose up redis -d
```

**3. 配置环境变量**

```bash
cp .env.example .env
# 本地无 Java 服务时，设置 DEV_AUTH_BYPASS=true
```

**4. 启动 Gateway**

```bash
npm run dev
```

**5. 启动调试客户端**

```bash
cd demo
npm install
npm run dev
```

打开 `http://localhost:3001`，连接 `ws://localhost:3000/ws` 即可调试。

## 本地测试

### 1. 确认 Redis 可用

```bash
redis-cli -h 127.0.0.1 -p 6379 ping
```

### 2. 用 demo 建立 WebSocket 连接

- WebSocket 地址填写 `ws://localhost:3000/ws`
- 本地调试建议在 `.env` 中设置 `DEV_AUTH_BYPASS=true`
- 已登录场景填写任意 `accessToken`，例如 `user-1`
- 游客场景填写任意 `lockdownToken`
- 收到 `connection_ack` 后说明连接成功

### 3. 测试用户消息

如果连接使用的是 `accessToken=user-1`：

```bash
redis-cli -h 127.0.0.1 -p 6379 GET ws:user_node:user-1
# 假设返回 node-1
redis-cli -h 127.0.0.1 -p 6379 PUBLISH ws:route:node-1 '{"type":"user","userId":"user-1","event":"balance_update","data":{"balance":999}}'
```

### 4. 测试 topic 订阅

先在 demo 中订阅 `ws.available-balances`，然后执行：

```bash
redis-cli -h 127.0.0.1 -p 6379 PUBLISH ws:push:topic:ws.available-balances '{"type":"topic","topic":"ws.available-balances","data":{"amount":100,"currency":"USD"}}'
```

客户端会收到：

```json
{
  "id": "59937ee9-aa79-40e9-95da-15ed1780ba91",
  "type": "next",
  "payload": {
    "data": {
      "amount": 100,
      "currency": "USD"
    }
  }
}
```

## Java 对接说明

### 认证接口（推荐方式）

Gateway 在 WebSocket 连接建立后，等待客户端发送 `connection_init`，其中包含 `accessToken` 或 `lockdownToken`。

```
POST {AUTH_TOKEN_VALIDATE_URL}
Content-Type: application/json

{ "accessToken": "<token>" }
```

或

```
{ "lockdownToken": "<token>" }
```

成功响应：

```json
{ "userId": "123", "username": "alice" }
```

失败响应：HTTP 401

### Redis 消息格式

#### 推给指定用户

先查节点，再精准投递：

```bash
GET ws:user_node:{userId}
PUBLISH ws:route:{nodeId} '{"type":"user","userId":"123","event":"balance_update","data":{}}'
```

消息格式：

```json
{
  "type": "user",
  "userId": "用户ID",
  "event": "事件名",
  "data": {}
}
```

#### 推给订阅了指定 topic 的连接

直接发布到对应 topic 通道：

```bash
PUBLISH ws:push:topic:ws.available-balances '{"type":"topic","topic":"ws.available-balances","data":{}}'
```

消息格式：

```json
{
  "type": "topic",
  "topic": "ws.available-balances",
  "data": {}
}
```

## WebSocket 协议

### 1. 连接初始化（必须）

客户端连接后必须立即发送：

```json
{
  "type": "connection_init",
  "payload": {
    "accessToken": "...",
    "language": "en"
  }
}
```

或：

```json
{
  "type": "connection_init",
  "payload": {
    "lockdownToken": "...",
    "language": "en"
  }
}
```

服务端成功响应：

```json
{ "type": "connection_ack" }
```

### 2. 订阅（必须显式订阅）

客户端只会收到自己订阅过的 topic 消息。

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "type": "subscribe",
  "payload": "ws.available-balances"
}
```

服务端后续推送：

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "type": "next",
  "payload": {
    "data": {
      "amount": 100,
      "currency": "USD"
    }
  }
}
```

### 3. 取消订阅

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "type": "complete"
}
```

### 4. 心跳

```json
{ "type": "ping" }
{ "type": "pong" }
```

## 消息模型说明

- `type=user`：只推给指定 `userId` 的在线连接
- `type=topic`：只推给订阅了该 topic 的连接

没有默认 `broadcast`。如果某类公共消息希望所有在线用户都收到，应由客户端在连接成功后统一订阅对应基础 topic，例如：

- `ws.announcements`
- `ws.feature-flag`

也就是说，“所有人都收到”不再由服务端默认广播保证，而是由客户端主动订阅一组公共 topic 来实现。

## Docker 部署

### 单节点

```bash
docker compose up -d
```

### 多节点（横向扩展）

```bash
docker compose up -d --scale ws-gateway=3
```

> 注意：每个节点的 `NODE_ID` 必须唯一，否则 Redis 路由会出错。

## 验证

```bash
npm run build
npm test
```
