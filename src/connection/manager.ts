import type { WebSocket } from 'uWebSockets.js';
import type { WsUserData, PushMessage } from '../types';

type WS = WebSocket<WsUserData>;

// userId → Set<WebSocket>（同一用户可能多个 tab 同时连接）
const connections = new Map<string, Set<WS>>();

export function add(userId: string, ws: WS): void {
  if (!connections.has(userId)) {
    connections.set(userId, new Set());
  }
  connections.get(userId)!.add(ws);
}

export function remove(userId: string, ws: WS): void {
  const sockets = connections.get(userId);
  if (!sockets) return;
  sockets.delete(ws);
  if (sockets.size === 0) connections.delete(userId);
}

/**
 * 向本节点的指定用户推送消息
 * @returns 是否找到该用户的连接
 */
export function sendToUser(userId: string, message: PushMessage): boolean {
  const sockets = connections.get(userId);
  if (!sockets || sockets.size === 0) return false;

  const data = JSON.stringify(message);
  for (const ws of sockets) {
    try {
      ws.send(data);
    } catch (err) {
      console.error(`[Connection] send to user ${userId} error:`, (err as Error).message);
    }
  }
  return true;
}

export function hasUser(userId: string): boolean {
  const sockets = connections.get(userId);
  return !!sockets && sockets.size > 0;
}

/**
 * 关闭指定用户在本节点的所有连接（互踢使用）
 * close 事件会异步触发，由 close handler 完成后续 connectionManager / Redis 清理
 */
export function closeUser(userId: string, code: number, reason: string): void {
  const sockets = connections.get(userId);
  if (!sockets) return;
  // 复制一份再遍历，避免 ws.end() 触发 close 时修改正在迭代的 Set
  for (const ws of [...sockets]) {
    try {
      ws.end(code, reason);
    } catch {
      // ignore
    }
  }
}

export function size(): number {
  let count = 0;
  for (const sockets of connections.values()) count += sockets.size;
  return count;
}

export function userIds(): string[] {
  return [...connections.keys()];
}

export function __resetForTests(): void {
  connections.clear();
}
