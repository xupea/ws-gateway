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

type WS = WebSocket<WsUserData>;

// topic → (subscriptionId → ws)
const topicRegistry = new Map<string, Map<string, WS>>();

/**
 * 注册一个订阅
 */
export function subscribe(topic: string, subscriptionId: string, ws: WS): void {
  if (!topicRegistry.has(topic)) {
    topicRegistry.set(topic, new Map());
  }
  topicRegistry.get(topic)!.set(subscriptionId, ws);
  // 同步写入连接自身的订阅表（便于断开时批量清理）
  ws.getUserData().subscriptions.set(subscriptionId, topic);
  console.log(`[Subscription] +subscribe topic="${topic}" id=${subscriptionId}`);
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
