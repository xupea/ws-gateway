import * as redis from '../redis';
import * as membership from '../cluster/membership';
import * as connectionManager from '../connection/manager';
import * as subscriptionManager from '../subscription/manager';
import config from '../config';
import type { PushMessage, UserMessage, BroadcastMessage, TopicPushMessage } from '../types';

export async function dispatch(message: PushMessage): Promise<void> {
  if (message.type === 'broadcast') {
    return dispatchBroadcast(message);
  }
  if (message.type === 'user') {
    return dispatchToUser(message);
  }
  if (message.type === 'topic') {
    return dispatchToTopic(message);
  }
  console.warn('[Dispatcher] unknown message type:', (message as PushMessage).type);
}

async function dispatchToUser(message: UserMessage): Promise<void> {
  const { userId } = message;

  // 用户在本节点，直接推
  if (connectionManager.hasUser(userId)) {
    connectionManager.sendToUser(userId, message);
    return;
  }

  // 第一步：通过一致性哈希环快速计算目标节点（纯内存，无 IO）
  const hashTargetNodeId = membership.getTargetNode(userId);
  if (!hashTargetNodeId) {
    console.debug(`[Dispatcher] no live nodes, message dropped`);
    return;
  }

  // 哈希环指向的节点不是本节点 → 直接转发，无需 Redis
  if (hashTargetNodeId !== config.server.nodeId) {
    await redis.routeToNode(hashTargetNodeId, message);
    return;
  }

  // 第二步：哈希环指向本节点但用户不在（LB 未做一致性哈希时会出现此情况）
  // Fallback：查 Redis 确认用户的真实节点，避免消息被误丢
  const actualNodeId = await redis.getUserNode(userId);
  if (!actualNodeId) {
    console.debug(`[Dispatcher] user ${userId} is offline, message dropped`);
    return;
  }

  if (actualNodeId === config.server.nodeId) {
    // Redis 也指向本节点，用户确实不在线
    console.debug(`[Dispatcher] user ${userId} is offline (confirmed), message dropped`);
    return;
  }

  // 转发到 Redis 中记录的真实节点
  console.debug(`[Dispatcher] hash miss for user ${userId}, routing via Redis to ${actualNodeId}`);
  await redis.routeToNode(actualNodeId, message);
}

function dispatchBroadcast(message: BroadcastMessage): void {
  // 广播：本节点推给所有连接
  // 所有节点都消费同一条 MQ 广播消息，各自广播给自己的连接
  connectionManager.broadcast(message);
}

/**
 * 推送给本节点上订阅了指定 topic 的所有连接
 * 每条 next 消息的 id 为该连接当初 subscribe 时客户端传入的 UUID
 */
function dispatchToTopic(message: TopicPushMessage): void {
  subscriptionManager.publish(message.topic, message.data);
}

/**
 * 处理从 Redis Pub/Sub 路由过来的消息（其他节点转发来的）
 */
export function handleRouted(message: PushMessage): void {
  if (message.type === 'broadcast') {
    connectionManager.broadcast(message);
    return;
  }
  if (message.type === 'user') {
    connectionManager.sendToUser(message.userId, message);
    return;
  }
  if (message.type === 'topic') {
    subscriptionManager.publish(message.topic, message.data);
  }
}
