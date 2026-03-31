import Redis from 'ioredis';
import config from '../config';
import type { PushMessage } from '../types';

type RouteHandler = (message: PushMessage) => void;
type IngressHandler = (message: PushMessage) => Promise<void>;

const client = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  db: config.redis.db,
  lazyConnect: true,
});

// Pub/Sub 订阅需要独立连接，订阅后该连接不能再执行普通命令
const routeSubscriber = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  db: config.redis.db,
  lazyConnect: true,
});

const ingressSubscriber = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  db: config.redis.db,
  lazyConnect: true,
});

client.on('error', (err) => console.error('[Redis] client error:', err.message));
routeSubscriber.on('error', (err) => console.error('[Redis] route subscriber error:', err.message));
ingressSubscriber.on('error', (err) => console.error('[Redis] ingress subscriber error:', err.message));

function isOpen(redis: Redis): boolean {
  return redis.status === 'ready' || redis.status === 'connect' || redis.status === 'connecting';
}

export async function connect(): Promise<void> {
  await client.connect();
  await routeSubscriber.connect();
  await ingressSubscriber.connect();
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
  await routeSubscriber.subscribe(channel);
  routeSubscriber.on('message', (ch: string, data: string) => {
    if (ch !== channel) return;
    try {
      handler(JSON.parse(data) as PushMessage);
    } catch (err) {
      console.error('[Redis] route message parse error:', (err as Error).message);
    }
  });
  console.log(`[Redis] subscribed to route channel: ${channel}`);
}

export async function subscribeToIngress(handler: IngressHandler): Promise<void> {
  const channel = config.redis.ingressChannel;
  await ingressSubscriber.subscribe(channel);
  ingressSubscriber.on('message', async (ch: string, data: string) => {
    if (ch !== channel) return;
    try {
      await handler(JSON.parse(data) as PushMessage);
    } catch (err) {
      console.error('[Redis] ingress message handler error:', (err as Error).message);
    }
  });
  console.log(`[Redis] subscribed to ingress channel: ${channel}`);
}

export async function close(): Promise<void> {
  await Promise.allSettled([
    client.quit(),
    routeSubscriber.quit(),
    ingressSubscriber.quit(),
  ]);
}

export function isHealthy(): boolean {
  return isOpen(client) && isOpen(routeSubscriber) && isOpen(ingressSubscriber);
}

export async function ping(): Promise<boolean> {
  try {
    return (await client.ping()) === 'PONG';
  } catch {
    return false;
  }
}

export { client };
