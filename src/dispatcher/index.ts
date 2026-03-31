import * as connectionManager from '../connection/manager';
import * as subscriptionManager from '../subscription/manager';
import type { PushMessage, SessionMessage, BroadcastMessage, TopicPushMessage } from '../types';

export async function dispatch(message: PushMessage): Promise<void> {
  if (message.type === 'session') {
    return dispatchToSession(message);
  }
  if (message.type === 'broadcast') {
    return dispatchBroadcast(message);
  }
  if (message.type === 'topic') {
    return dispatchToTopic(message);
  }
  console.warn('[Dispatcher] unknown message type:', (message as PushMessage).type);
}

/**
 * 推送给指定 session（authToken）
 * RabbitMQ Consistent Hash Exchange 以 authToken 为 routing key，
 * 保证消息直接路由到持有该连接的节点，无需跨节点转发。
 */
function dispatchToSession(message: SessionMessage): void {
  const { authToken } = message;

  if (!connectionManager.sendToSession(authToken, message)) {
    // 该 authToken 对应的连接不在本节点（正常情况不会发生，因为 CH Exchange 已保证路由正确）
    console.debug(`[Dispatcher] session ${authToken} not found on this node, message dropped`);
  }
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
  const { topic, data } = message;

  // 验证 topic 是否支持
  if (!subscriptionManager.isSupportedTopic(topic)) {
    console.warn(`[Dispatcher] unsupported topic: ${topic}, message dropped`);
    return;
  }

  subscriptionManager.publish(topic, data);
}
