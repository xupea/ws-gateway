import dotenv from 'dotenv';
dotenv.config();

const config = {
  server: {
    port: parseInt(process.env.PORT ?? '3000'),
    nodeId: process.env.NODE_ID ?? process.env.HOSTNAME ?? `node-${process.pid}`,
    wsIdleTimeout: parseInt(process.env.WS_IDLE_TIMEOUT_SEC ?? '120'),
    shutdownGraceMs: parseInt(process.env.SHUTDOWN_GRACE_MS ?? '10000'),
  },

  auth: {
    validateUrl: process.env.AUTH_VALIDATE_URL ?? 'http://localhost:8080/internal/session/validate',
    tokenValidateUrl: process.env.AUTH_TOKEN_VALIDATE_URL ?? 'http://localhost:8080/internal/token/validate',
    sessionCookieName: process.env.SESSION_COOKIE_NAME ?? 'session',
    timeoutMs: parseInt(process.env.AUTH_TIMEOUT_MS ?? '3000'),
    // DEV_AUTH_BYPASS=true 时跳过认证，直接用 accessToken/lockdownToken 作为 userId，仅用于本地调试
    devBypass: process.env.DEV_AUTH_BYPASS === 'true',
  },

  redis: {
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT ?? '6379'),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB ?? '0'),
    userNodePrefix: 'ws:user_node:',
    ingressChannel: process.env.REDIS_INGRESS_CHANNEL ?? 'ws:push',
    routeChannelPrefix: 'ws:route:',
  },
} as const;

export type Config = typeof config;
export default config;
