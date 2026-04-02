import dotenv from 'dotenv';
dotenv.config();

const redisUserNodeTtlSec = parseInt(process.env.REDIS_USER_NODE_TTL_SEC ?? '7200');
const redisUserNodeRefreshMs = parseInt(
  process.env.REDIS_USER_NODE_REFRESH_MS ?? String(Math.max(60_000, Math.floor((redisUserNodeTtlSec * 1000) / 2))),
);

const config = {
  server: {
    port: parseInt(process.env.PORT ?? '3000'),
    nodeId: process.env.NODE_ID ?? process.env.HOSTNAME ?? `node-${process.pid}`,
    wsIdleTimeout: parseInt(process.env.WS_IDLE_TIMEOUT_SEC ?? '120'),
    shutdownGraceMs: parseInt(process.env.SHUTDOWN_GRACE_MS ?? '10000'),
    // 连接建立后等待 connection_init 的最大时间，超时强制断开
    initTimeoutMs: parseInt(process.env.WS_INIT_TIMEOUT_MS ?? '10000'),
    // 单个连接允许的最大订阅数
    maxSubscriptionsPerConnection: parseInt(process.env.WS_MAX_SUBSCRIPTIONS ?? '20'),
  },

  auth: {
    validateUrl: process.env.AUTH_VALIDATE_URL ?? 'http://localhost:8080/internal/session/validate',
    tokenValidateUrl: process.env.AUTH_TOKEN_VALIDATE_URL ?? 'http://localhost:8080/internal/token/validate',
    sessionCookieName: process.env.SESSION_COOKIE_NAME ?? 'session',
    timeoutMs: parseInt(process.env.AUTH_TIMEOUT_MS ?? '3000'),
    // DEV_AUTH_BYPASS=true 时跳过认证，直接用 accessToken/lockdownToken 作为 userId，仅用于本地调试
    devBypass: process.env.DEV_AUTH_BYPASS === 'true',
    // 认证结果本地缓存 TTL（ms），避免高并发重连时冲击 Java 认证服务
    cacheTtlMs: parseInt(process.env.AUTH_CACHE_TTL_MS ?? '30000'),
    // 认证缓存最大条目数
    cacheMaxSize: parseInt(process.env.AUTH_CACHE_MAX_SIZE ?? '100000'),
  },

  redis: {
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT ?? '6379'),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB ?? '0'),
    userNodePrefix: 'ws:user_node:',
    topicChannelPrefix: process.env.REDIS_TOPIC_CHANNEL_PREFIX ?? 'ws:push:topic:',
    routeChannelPrefix: 'ws:route:',
    // user_node 映射 TTL（秒），节点异常宕机时限制消息静默丢失的时间窗口
    userNodeTtlSec: redisUserNodeTtlSec,
    // 在线用户映射定期续期，避免长连接超过 TTL 后精准路由失效
    userNodeRefreshIntervalMs: redisUserNodeRefreshMs,
  },
} as const;

export type Config = typeof config;
export default config;
