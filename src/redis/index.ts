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

// ── 集群成员管理 ──────────────────────────────────────────────────────────────

/**
 * 注册本节点并续期心跳 TTL
 */
export async function registerNode(nodeId: string): Promise<void> {
  const ttlSec = Math.ceil(config.cluster.heartbeatTtlMs / 1000);
  await client
    .multi()
    .sadd(config.redis.clusterNodesKey, nodeId)
    .set(`${config.redis.clusterHbPrefix}${nodeId}`, '1', 'EX', ttlSec)
    .exec();
}

/**
 * 节点退出时主动注销（加速感知，不等 TTL 过期）
 */
export async function deregisterNode(nodeId: string): Promise<void> {
  await client
    .multi()
    .srem(config.redis.clusterNodesKey, nodeId)
    .del(`${config.redis.clusterHbPrefix}${nodeId}`)
    .exec();
}

/**
 * 获取当前存活节点列表，并顺手清理已过期的节点记录
 */
export async function getLiveNodes(): Promise<string[]> {
  const allNodes = await client.smembers(config.redis.clusterNodesKey);
  if (allNodes.length === 0) return [];

  const pipeline = client.pipeline();
  for (const nodeId of allNodes) {
    pipeline.exists(`${config.redis.clusterHbPrefix}${nodeId}`);
  }
  const results = await pipeline.exec();

  const live: string[] = [];
  const dead: string[] = [];
  for (let i = 0; i < allNodes.length; i++) {
    const exists = (results![i][1] as number);
    if (exists) live.push(allNodes[i]);
    else dead.push(allNodes[i]);
  }

  if (dead.length > 0) {
    await client.srem(config.redis.clusterNodesKey, ...dead);
  }

  return live;
}

// ── 用户节点映射（供 dispatcher fallback 查询） ──────────────────────────────

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
