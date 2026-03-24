# ws-gateway

基于 Node.js + uWebSockets.js 实现的高性能 WebSocket 推送网关，支持横向扩展。

## 架构

```
Java 服务端
    │
    │  发消息（RabbitMQ）
    ▼
┌─────────────────────────────────────────┐
│              RabbitMQ                   │
│           队列: ws.push                 │
└────────────┬────────────────────────────┘
             │ 消费
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
2. 任意节点从 RabbitMQ 消费到消息后，先检查目标用户是否在本节点
3. 在本节点 → 直接推送；不在 → 查 Redis 找到目标节点，通过 Redis Pub/Sub 转发

## 技术栈

| 模块 | 选型 |
|------|------|
| WebSocket 服务器 | uWebSockets.js |
| 消息队列 | RabbitMQ（amqplib，可替换） |
| 节点路由 | Redis Pub/Sub（ioredis） |
| 语言 | TypeScript |

## 目录结构

```
ws-gateway/
├── src/
│   ├── types/index.ts          # 公共类型定义
│   ├── config/index.ts         # 配置（读环境变量）
│   ├── mq/
│   │   ├── index.ts            # MQ 抽象类（换 Kafka 只改这里）
│   │   └── rabbitmq.ts         # RabbitMQ 实现
│   ├── redis/index.ts          # Redis 连接 + 路由逻辑
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
| `AUTH_VALIDATE_URL` | `http://localhost:8080/internal/session/validate` | Java 认证接口地址 |
| `SESSION_COOKIE_NAME` | `session` | session cookie 名称 |
| `AUTH_TIMEOUT_MS` | `3000` | 认证请求超时（ms） |
| `DEV_AUTH_BYPASS` | `false` | **仅开发用**，跳过认证，直接用 cookie 值作为 userId |
| `REDIS_HOST` | `127.0.0.1` | Redis 地址 |
| `REDIS_PORT` | `6379` | Redis 端口 |
| `REDIS_PASSWORD` | — | Redis 密码（可选） |
| `REDIS_DB` | `0` | Redis 数据库编号 |
| `RABBITMQ_URL` | `amqp://guest:guest@localhost:5672` | RabbitMQ 连接串 |
| `RABBITMQ_QUEUE` | `ws.push` | Gateway 消费的队列名 |
| `RABBITMQ_PREFETCH` | `100` | 每节点最大未 ack 消息数 |

## 本地开发

### 前置条件

- Node.js 20+
- Docker（用于启动 Redis + RabbitMQ）

### 启动

**1. 安装依赖**

```bash
npm install
```

**2. 启动 Redis 和 RabbitMQ**

```bash
docker compose up redis rabbitmq -d
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

打开 `http://localhost:3001`，填入任意 userId，点击 Connect 即可连接。

### 测试推送消息

打开 RabbitMQ 管理界面 `http://localhost:15672`（账号/密码均为 `guest`），
进入 `ws.push` 队列，手动发布消息：

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

### 认证接口

Gateway 在 WebSocket 握手时会调用此接口验证 session：

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

### MQ 消息格式

Java 向 `ws.push` 队列发送 JSON 消息：

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

### WebSocket 协议

**客户端心跳：**
```json
{ "type": "ping" }
```

**服务端响应：**
```json
{ "type": "pong", "ts": 1700000000000 }
```

**健康检查接口：**
```
GET /health
```
```json
{ "status": "ok", "nodeId": "node-1", "connections": 42 }
```

## 替换 MQ

当前 RabbitMQ 实现在 `src/mq/rabbitmq.ts`，继承自 `src/mq/index.ts` 的抽象类。

替换为 Kafka 时，只需新建 `src/mq/kafka.ts` 实现同一抽象类，然后在 `src/index.ts` 替换导入即可，其余代码无需改动。
