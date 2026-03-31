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
    tokenValidateUrl: process.env.AUTH_TOKEN_VALIDATE_URL ?? 'http://localhost:8080/internal/token/validate',
    timeoutMs: parseInt(process.env.AUTH_TIMEOUT_MS ?? '3000'),
    // DEV_AUTH_BYPASS=true 时跳过认证，直接认为 token 有效，仅用于本地调试
    devBypass: process.env.DEV_AUTH_BYPASS === 'true',
  },

  rabbitmq: {
    url: process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672',
    queue: process.env.RABBITMQ_QUEUE ?? 'ws.push',
    prefetch: parseInt(process.env.RABBITMQ_PREFETCH ?? '100'),
    // 消息 TTL：节点宕机时队列中的消息超时自动丢弃，避免恢复后推送过期数据
    messageTtlMs: parseInt(process.env.RABBITMQ_MESSAGE_TTL_MS ?? '30000'),
    // 一致性哈希绑定权重，所有节点相同权重保证均匀分配
    bindingWeight: process.env.RABBITMQ_BINDING_WEIGHT ?? '10',
  },
} as const;

export type Config = typeof config;
export default config;
