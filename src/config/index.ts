import dotenv from 'dotenv';
dotenv.config();

const config = {
  server: {
    port: parseInt(process.env.PORT ?? '3000'),
    nodeId: process.env.NODE_ID ?? `node-${process.pid}`,
  },

  auth: {
    validateUrl: process.env.AUTH_VALIDATE_URL ?? 'http://localhost:8080/internal/session/validate',
    sessionCookieName: process.env.SESSION_COOKIE_NAME ?? 'session',
    timeoutMs: parseInt(process.env.AUTH_TIMEOUT_MS ?? '3000'),
    // DEV_AUTH_BYPASS=true 时跳过认证，直接用 session 值作为 userId，仅用于本地调试
    devBypass: process.env.DEV_AUTH_BYPASS === 'true',
  },

  redis: {
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT ?? '6379'),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB ?? '0'),
    userNodePrefix: 'ws:user_node:',
    routeChannelPrefix: 'ws:route:',
  },

  rabbitmq: {
    url: process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672',
    queue: process.env.RABBITMQ_QUEUE ?? 'ws.push',
    prefetch: parseInt(process.env.RABBITMQ_PREFETCH ?? '100'),
  },
} as const;

export type Config = typeof config;
export default config;
