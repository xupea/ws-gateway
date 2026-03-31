import type { WebSocket } from 'uWebSockets.js';
import type { WsUserData, PushMessage } from '../types';

type WS = WebSocket<WsUserData>;

// authToken → WebSocket（1 authToken = 1 连接，不支持多 tab / 多端登录）
const connections = new Map<string, WS>();

export function add(authToken: string, ws: WS): void {
  connections.set(authToken, ws);
}

export function remove(authToken: string): void {
  connections.delete(authToken);
}

/**
 * 向本节点的指定 session（authToken）推送消息
 * @returns 是否找到该连接
 */
export function sendToSession(authToken: string, message: PushMessage): boolean {
  const ws = connections.get(authToken);
  if (!ws) return false;

  try {
    ws.send(JSON.stringify(message));
  } catch (err) {
    console.error(`[Connection] send to session error:`, (err as Error).message);
  }
  return true;
}

export function broadcast(message: PushMessage): void {
  const data = JSON.stringify(message);
  for (const ws of connections.values()) {
    try {
      ws.send(data);
    } catch {
      // ignore individual send errors
    }
  }
}

export function hasSession(authToken: string): boolean {
  return connections.has(authToken);
}

export function size(): number {
  return connections.size;
}
