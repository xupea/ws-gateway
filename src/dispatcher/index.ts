import * as connectionManager from '../connection/manager';
import * as subscriptionManager from '../subscription/manager';
import type { PushMessage, UserMessage, TopicPushMessage } from '../types';

/**
 * 兼容旧入口的分发逻辑。
 *
 * 仅保留给迁移期使用。当前正式协议只包含：
 *   - user：Java 先查 user_node，再精准投递到 ws:route:{nodeId}
 *   - topic：Java 发布到 ws:push:topic:{topic}，所有节点各自推送本地订阅者
 */
export function dispatch(message: PushMessage): void {
  if (message.type === 'user') {
    return dispatchToUser(message);
  }
  if (message.type === 'topic') {
    return dispatchToTopic(message);
  }
  console.warn('[Dispatcher] unknown message type:', (message as PushMessage).type);
}

export function dispatchTopicIngress(message: PushMessage): void {
  if (message.type !== 'topic') {
    console.warn('[Dispatcher] non-topic message received on topic ingress');
    return;
  }
  dispatchToTopic(message);
}

function dispatchToUser(message: UserMessage): void {
  const { userId } = message;

  if (connectionManager.hasUser(userId)) {
    connectionManager.sendToUser(userId, message);
    return;
  }

  // 用户不在本节点：由持有该用户连接的节点负责推送，本节点跳过。
  // 所有节点都会收到这条 ingress 消息，用户所在节点一定也会收到并处理。
  console.debug(`[Dispatcher] user ${userId} not on this node, skipping`);
}

function dispatchToTopic(message: TopicPushMessage): void {
  const { topic, data } = message;
  if (!subscriptionManager.isSupportedTopic(topic)) {
    console.warn(`[Dispatcher] unsupported topic: ${topic}, message dropped`);
    return;
  }
  subscriptionManager.publish(topic, data);
}

/**
 * 处理来自 ws:route:{nodeId} 通道的消息。
 * 用于 Java 侧先查询 user_node 再精准发布到本节点的场景，
 * 以及节点间互踢指令。
 */
export function handleRouted(message: PushMessage): void {
  if (message.type === 'kick') {
    // 收到其他节点发来的踢除指令，关闭本节点上该用户的所有连接
    // close handler 会自动清理 connectionManager，并通过 removeUserNodeIfOwner
    // 确保不会错误删除已被新节点更新的 Redis 映射
    connectionManager.closeUser(message.userId, 4409, 'logged in elsewhere');
    console.log(`[Dispatcher] kicked user ${message.userId} (routed from another node)`);
    return;
  }
  if (message.type === 'user') {
    connectionManager.sendToUser(message.userId, message);
    return;
  }
  if (message.type === 'topic') {
    if (!subscriptionManager.isSupportedTopic(message.topic)) {
      console.warn(`[Dispatcher] routed unsupported topic: ${message.topic}, message dropped`);
      return;
    }
    subscriptionManager.publish(message.topic, message.data);
  }
}
