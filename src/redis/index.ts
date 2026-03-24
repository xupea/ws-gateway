import Redis from 'ioredis';
import config from '../config';
import type { PushMessage } from '../types';

type RouteHandler = (message: PushMessage) => void;

const client = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  db: config.redis.db,
  lazyConnect: true,
});

// Pub/Sub 订阅需要独立连接，订阅后该连接不能再执行普通命令
const subscriber = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  db: config.redis.db,
  lazyConnect: true,
});

client.on('error', (err) => console.error('[Redis] client error:', err.message));
subscriber.on('error', (err) => console.error('[Redis] subscriber error:', err.message));

export async function connect(): Promise<void> {
  await client.connect();
  await subscriber.connect();
  console.log('[Redis] connected');
}

export async function setUserNode(userId: string): Promise<void> {
  await client.set(
    `${config.redis.userNodePrefix}${userId}`,
    config.server.nodeId,
    'EX', 86400,
  );
}

export async function removeUserNode(userId: string): Promise<void> {
  await client.del(`${config.redis.userNodePrefix}${userId}`);
}

export async function getUserNode(userId: string): Promise<string | null> {
  return client.get(`${config.redis.userNodePrefix}${userId}`);
}

export async function routeToNode(nodeId: string, message: PushMessage): Promise<void> {
  await client.publish(
    `${config.redis.routeChannelPrefix}${nodeId}`,
    JSON.stringify(message),
  );
}

export async function subscribeToRoutes(handler: RouteHandler): Promise<void> {
  const channel = `${config.redis.routeChannelPrefix}${config.server.nodeId}`;
  await subscriber.subscribe(channel);
  subscriber.on('message', (ch: string, data: string) => {
    if (ch !== channel) return;
    try {
      handler(JSON.parse(data) as PushMessage);
    } catch (err) {
      console.error('[Redis] route message parse error:', (err as Error).message);
    }
  });
  console.log(`[Redis] subscribed to route channel: ${channel}`);
}

export { client };
