/**
 * 订阅管理器
 *
 * 数据结构：
 *   topicRegistry: topic → Map<subscriptionId, WS>
 *
 * 配合 WsUserData.subscriptions (subscriptionId → topic) 使用：
 *   - subscribe/unsubscribe 维护 topicRegistry
 *   - 断开时由 server.ts 遍历 WsUserData.subscriptions 逐一调用 unsubscribe
 */
import type { WebSocket } from 'uWebSockets.js';
import type { WsUserData, NextMessage } from '../types';
import { SUPPORTED_TOPICS } from '../types';

type WS = WebSocket<WsUserData>;

// topic → (subscriptionId → ws)
const topicRegistry = new Map<string, Map<string, WS>>();

/**
 * 验证 topic 是否在支持列表中
 */
export function isSupportedTopic(topic: string): boolean {
  return SUPPORTED_TOPICS.includes(topic as any);
}

/**
 * 注册一个订阅
 */
export function subscribe(topic: string, subscriptionId: string, ws: WS): boolean {
  // 验证 topic 是否支持
  if (!isSupportedTopic(topic)) {
    console.warn(`[Subscription] unsupported topic: ${topic}`);
    return false;
  }

  // 同一连接重复使用同一个 subscriptionId 时，先摘掉旧 topic，避免幽灵订阅残留
  const existingTopic = ws.getUserData().subscriptions.get(subscriptionId);
  if (existingTopic && existingTopic !== topic) {
    unsubscribe(existingTopic, subscriptionId);
    ws.getUserData().subscriptions.delete(subscriptionId);
  }

  if (!topicRegistry.has(topic)) {
    topicRegistry.set(topic, new Map());
  }
  topicRegistry.get(topic)!.set(subscriptionId, ws);
  // 同步写入连接自身的订阅表（便于断开时批量清理）
  ws.getUserData().subscriptions.set(subscriptionId, topic);
  console.log(`[Subscription] +subscribe topic="${topic}" id=${subscriptionId}`);
  return true;
}

/**
 * 注销一个订阅（由 complete 消息或断开触发）
 */
export function unsubscribe(topic: string, subscriptionId: string): void {
  const subs = topicRegistry.get(topic);
  if (!subs) return;
  subs.delete(subscriptionId);
  if (subs.size === 0) topicRegistry.delete(topic);
  console.log(`[Subscription] -unsubscribe topic="${topic}" id=${subscriptionId}`);
}

/**
 * 断开连接时清理该 ws 的全部订阅
 */
export function unsubscribeAll(ws: WS): void {
  const { subscriptions } = ws.getUserData();
  for (const [subscriptionId, topic] of subscriptions) {
    unsubscribe(topic, subscriptionId);
  }
  subscriptions.clear();
}

/**
 * 向订阅了指定 topic 的所有连接推送 next 消息
 */
export function publish(topic: string, data: unknown): void {
  const subs = topicRegistry.get(topic);
  if (!subs || subs.size === 0) return;

  for (const [subscriptionId, ws] of subs) {
    const msg: NextMessage = {
      id: subscriptionId,
      type: 'next',
      payload: { data },
    };
    try {
      ws.send(JSON.stringify(msg));
    } catch (err) {
      console.error(
        `[Subscription] send error topic="${topic}" id=${subscriptionId}:`,
        (err as Error).message,
      );
    }
  }
}

/** 当前全局订阅总数（用于监控） */
export function size(): number {
  let count = 0;
  for (const subs of topicRegistry.values()) count += subs.size;
  return count;
}

export function __resetForTests(): void {
  topicRegistry.clear();
}
