import dotenv from 'dotenv';
dotenv.config();

const config = {
  server: {
    port: parseInt(process.env.PORT ?? '3000'),
    // NODE_ID 由 bootstrap.ts 在启动阶段异步解析后写入 process.env，
    // 此处同步读取时已保证有值（ECS Task ARN 末段 或 PID 兜底）
    nodeId: process.env.NODE_ID ?? `node-${process.pid}`,
  },

  auth: {
    validateUrl: process.env.AUTH_VALIDATE_URL ?? 'http://localhost:8080/internal/session/validate',
    tokenValidateUrl: process.env.AUTH_TOKEN_VALIDATE_URL ?? 'http://localhost:8080/internal/token/validate',
    sessionCookieName: process.env.SESSION_COOKIE_NAME ?? 'session',
    timeoutMs: parseInt(process.env.AUTH_TIMEOUT_MS ?? '3000'),
    // DEV_AUTH_BYPASS=true 时跳过认证，直接用 accessToken 作为 userId，仅用于本地调试
    devBypass: process.env.DEV_AUTH_BYPASS === 'true',
  },

  redis: {
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT ?? '6379'),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB ?? '0'),
    userNodePrefix: 'ws:user_node:',      // fallback 路由用
    routeChannelPrefix: 'ws:route:',
    clusterNodesKey: 'ws:cluster:nodes',
    clusterHbPrefix: 'ws:cluster:hb:',
  },

  cluster: {
    // 心跳间隔（ms），节点每隔此时间续期并同步成员列表
    heartbeatIntervalMs: parseInt(process.env.CLUSTER_HEARTBEAT_INTERVAL_MS ?? '5000'),
    // 心跳 TTL（ms），超过此时间未续期则视为节点下线
    heartbeatTtlMs: parseInt(process.env.CLUSTER_HEARTBEAT_TTL_MS ?? '15000'),
    // 每个真实节点的虚拟节点数，越大分布越均匀
    virtualNodes: parseInt(process.env.CLUSTER_VIRTUAL_NODES ?? '150'),
  },

  rabbitmq: {
    url: process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672',
    queue: process.env.RABBITMQ_QUEUE ?? 'ws.push',
    prefetch: parseInt(process.env.RABBITMQ_PREFETCH ?? '100'),
  },
} as const;

export type Config = typeof config;
export default config;
