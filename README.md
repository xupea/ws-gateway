# ws-gateway

基于 Node.js + uWebSockets.js 实现的高性能 WebSocket 推送网关，支持横向扩展。

## 架构

```
Java 服务端
    │
    │  发布消息（Redis Pub/Sub）
    ▼
┌─────────────────────────────────────────┐
│                Redis                    │
│         channel: ws:push                │
└────────────┬────────────────────────────┘
             │ 订阅入口消息
    ┌────────┼────────┐
    ▼        ▼        ▼
  Node1    Node2    Node3      ← 多节点横向扩展
    │        │        │
    └────────┼────────┘
             │ 节点间路由（Redis Pub/Sub）
             ▼
          Redis
    （记录 userId → 节点映射）
             │
             ▼
          客户端
```

**消息路由逻辑：**
1. 用户连接时，Redis 记录 `userId → nodeId`
2. 任意节点从 Redis 入口 channel 收到消息后，先检查目标用户是否在本节点
3. 在本节点 → 直接推送；不在 → 查 Redis 找到目标节点，通过 Redis Pub/Sub 转发

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
│   ├── types/index.ts          # 公共类型定义
│   ├── config/index.ts         # 配置（读环境变量）
│   ├── redis/index.ts          # Redis 连接 + 入口订阅 + 路由逻辑
│   ├── auth/index.ts           # 认证（调 Java HTTP 接口）
│   ├── connection/manager.ts   # 本节点连接管理
│   ├── dispatcher/index.ts     # 消息分发核心逻辑
│   ├── ws/server.ts            # WebSocket 服务器
│   └── index.ts                # 启动入口
├── demo/                       # 本地调试用 Next.js 客户端
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
| `WS_IDLE_TIMEOUT_SEC` | `120` | WebSocket 空闲超时（秒），建议与客户端 ping 周期配合使用 |
| `SHUTDOWN_GRACE_MS` | `10000` | 收到退出信号后摘流量并等待连接自然结束的时间（毫秒） |
| `AUTH_VALIDATE_URL` | `http://localhost:8080/internal/session/validate` | Java 认证接口地址（保留备用，Cookie 方式） |
| `AUTH_TOKEN_VALIDATE_URL` | `http://localhost:8080/internal/token/validate` | **推荐** Java 认证接口地址（WebSocket connection_init 方式） |
| `SESSION_COOKIE_NAME` | `session` | session cookie 名称 |
| `AUTH_TIMEOUT_MS` | `3000` | 认证请求超时（ms） |
| `DEV_AUTH_BYPASS` | `false` | **仅开发用**，跳过认证，直接用 token 值作为 userId |
| `REDIS_HOST` | `127.0.0.1` | Redis 地址 |
| `REDIS_PORT` | `6379` | Redis 端口 |
| `REDIS_PASSWORD` | — | Redis 密码（可选） |
| `REDIS_DB` | `0` | Redis 数据库编号 |
| `REDIS_INGRESS_CHANNEL` | `ws:push` | Gateway 订阅的入口消息 channel |

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
# 确保 DEV_AUTH_BYPASS=true（本地无 Java 服务时使用）
```

**4. 启动 Gateway**

```bash
npm run dev   # 监听 :3000
```

**5. 启动调试客户端**

```bash
cd demo
npm install
npm run dev   # 监听 :3001
```

打开 `http://localhost:3001`，勾选 "Logged In" 选项或保持未勾选状态（游客），填入对应的 accessToken 或 lockdownToken，点击 Connect 即可连接。

### 测试推送消息

用 `redis-cli` 向 `ws:push` channel 发布 JSON 消息：

**推送给指定用户：**
```json
{
  "type": "user",
  "userId": "user-1",
  "event": "balance_update",
  "data": { "balance": 999 }
}
```

**广播给所有人：**
```json
{
  "type": "broadcast",
  "event": "announcement",
  "data": { "text": "Hello everyone!" }
}
```

示例命令：

```bash
redis-cli PUBLISH ws:push '{"type":"broadcast","event":"announcement","data":{"text":"Hello everyone!"}}'
```

## Docker 部署

### 单节点

```bash
docker compose up -d
```

### 多节点（横向扩展）

多节点时需用 Nginx 做负载均衡，去掉 `docker-compose.yml` 中 `ws-gateway` 的 `ports` 配置后：

```bash
docker compose up -d --scale ws-gateway=3
```

> **注意**：每个节点的 `NODE_ID` 必须唯一，否则 Redis 路由会出错。
> 生产部署建议通过 Kubernetes 或 ECS 任务 ID 自动注入。

## Java 对接说明

### 认证接口（推荐方式）

Gateway 在 WebSocket 连接建立后，等待客户端发送 `connection_init` 消息，其中包含 `accessToken`（已登录用户）或 `lockdownToken`（游客用户）。

Gateway 会调用此接口验证 token：

```
POST {AUTH_TOKEN_VALIDATE_URL}
Content-Type: application/json

{ "accessToken": "<token>" }
```

或

```
{ "lockdownToken": "<token>" }
```

**成功响应（200）：**
```json
{ "userId": "123", "username": "alice" }
```

**失败响应：** HTTP 401

### 认证接口（保留备用 - Cookie 方式）

Gateway 在 WebSocket 握手时会调用此接口验证 session（需要客户端在 Cookie 中发送）：

```
POST {AUTH_VALIDATE_URL}
Content-Type: application/json

{ "session": "<cookie 值>" }
```

**成功响应（200）：**
```json
{ "userId": "123", "username": "alice" }
```

**失败响应：** HTTP 401

### 入口消息格式

Java 向 Redis `ws:push` channel 发布 JSON 消息：

**推给指定用户：**
```json
{
  "type": "user",
  "userId": "用户ID",
  "event": "事件名",
  "data": {}
}
```

**广播给所有在线用户：**
```json
{
  "type": "broadcast",
  "event": "事件名",
  "data": {}
}
```

**推给订阅了指定 topic 的连接：**
```json
{
  "type": "topic",
  "topic": "ws.available-balances",
  "data": {}
}
```

### WebSocket 协议

#### 1. 连接初始化（必须）

客户端连接后立即发送 `connection_init` 消息进行身份验证：

```json
{
  "type": "connection_init",
  "payload": {
    "accessToken": "...",
    "language": "en"
  }
}
```

或（游客用户）：

```json
{
  "type": "connection_init",
  "payload": {
    "lockdownToken": "...",
    "language": "en"
  }
}
```

服务端验证成功后返回：

```json
{ "type": "connection_ack" }
```

只有收到 `connection_ack` 后，才能发送其他消息。

#### 2. 订阅（可选）

客户端发起订阅请求：

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "type": "subscribe",
  "payload": "ws.available-balances"
}
```

服务端接收订阅（不返回确认），当有数据时会推送：

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

#### 3. 取消订阅

客户端发送 `complete` 消息停止订阅：

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "type": "complete"
}
```

#### 4. 心跳

客户端定期发送 ping，服务端响应 pong：

**客户端：**
```json
{ "type": "ping" }
```

**服务端：**
```json
{ "type": "pong" }
```

生产环境建议客户端每 30-60 秒发送一次 `ping`，避免 Cloudflare 或 ALB 因连接长期空闲而主动断开。

#### 5. 健康检查接口

```
GET /health
```

```json
{
  "status": "ok",
  "nodeId": "node-1",
  "redis": "ok",
  "draining": false,
  "connections": 42,
  "subscriptions": 128
}
```

当实例进入优雅停机阶段或 Redis 不可用时，`/health` 会返回 `503`。

#### 6. 就绪检查接口

```
GET /ready
```

用于负载均衡摘流量或容器启动探针。服务处于摘流量阶段，或 Redis `PING` 失败时，该接口返回 `503`。

## 消息模型说明

Java 侧只需要做一件事：向 Redis `ws:push` channel 发布 JSON 消息，Gateway 会负责后续分发。

- `type=user`：网关会查找用户当前所在节点，并只把消息推给该用户的在线连接
- `type=broadcast`：每个网关节点都会把消息广播给自己持有的在线连接
- `type=topic`：每个网关节点都会把消息推给本节点上订阅了该 topic 的连接

节点之间的定向转发走 `ws:route:{nodeId}` channel，这部分对业务方透明，不需要额外处理。

需要注意的是，当前方案是“在线尽力投递”模型：只保证消息发给当前在线的连接，不提供消息持久化、消费确认、失败重放或离线补发能力。
