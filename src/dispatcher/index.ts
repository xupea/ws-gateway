import * as redis from '../redis';
import * as connectionManager from '../connection/manager';
import * as subscriptionManager from '../subscription/manager';
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

  // 查 Redis 找用户在哪个节点
  const targetNodeId = await redis.getUserNode(userId);
  if (!targetNodeId) {
    console.debug(`[Dispatcher] user ${userId} is offline, message dropped`);
    return;
  }

  // 转发给目标节点
  await redis.routeToNode(targetNodeId, message);
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
