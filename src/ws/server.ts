import uWS from 'uWebSockets.js';
import { authenticateByToken } from '../auth';
import * as connectionManager from '../connection/manager';
import * as subscriptionManager from '../subscription/manager';
import * as redis from '../redis';
import config from '../config';
import type { WsUserData, ConnectionInitMessage, SubscribeMessage, CompleteMessage } from '../types';

export function createServer(): uWS.TemplatedApp {
  const app = uWS.App();

  app.ws<WsUserData>('/ws', {
    maxPayloadLength: 16 * 1024,
    idleTimeout: 60,

    upgrade: (res, req, context) => {
      const secKey = req.getHeader('sec-websocket-key');
      const secProtocol = req.getHeader('sec-websocket-protocol');
      const secExtension = req.getHeader('sec-websocket-extensions');

      // 不在握手阶段做认证，等待客户端发送 connection_init
      res.upgrade<WsUserData>(
        { userId: '', user: null, initialized: false, subscriptions: new Map() },
        secKey, secProtocol, secExtension,
        context,
      );
    },

    open: (_ws) => {
      console.log('[WS] new connection established, waiting for connection_init');
    },

    message: async (ws, message) => {
      const data = ws.getUserData();
      const text = Buffer.from(message).toString();

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return; // ignore malformed messages
      }

      const msg = parsed as Record<string, unknown>;

      // ── 1. 未初始化：只接受 connection_init ──────────────────────────────
      if (!data.initialized) {
        if (msg.type !== 'connection_init') {
          ws.end(4400, 'connection_init required');
          return;
        }

        const { payload } = parsed as unknown as ConnectionInitMessage;
        const accessToken = payload?.accessToken;
        const lockdownToken = payload?.lockdownToken;

        if (!accessToken && !lockdownToken) {
          ws.end(4400, 'missing accessToken or lockdownToken');
          return;
        }

        const user = await authenticateByToken(accessToken, lockdownToken);
        if (!user) {
          ws.end(4401, 'Unauthorized');
          return;
        }

        data.userId = user.userId;
        data.user = user;
        data.initialized = true;

        connectionManager.add(user.userId, ws);
        await redis.setUserNode(user.userId);

        ws.send(JSON.stringify({ type: 'connection_ack' }));
        console.log(`[WS] user ${user.userId} initialized, total: ${connectionManager.size()}`);
        return;
      }

      // ── 2. 已初始化：处理各类消息 ─────────────────────────────────────────

      switch (msg.type) {
        case 'ping': {
          ws.send(JSON.stringify({ type: 'pong' }));
          break;
        }

        case 'subscribe': {
          const { id, payload: topic } = parsed as unknown as SubscribeMessage;
          if (!id || typeof topic !== 'string') {
            console.warn('[WS] invalid subscribe message, ignored');
            return;
          }
          subscriptionManager.subscribe(topic, id, ws);
          break;
        }

        case 'complete': {
          const { id } = parsed as unknown as CompleteMessage;
          if (!id) return;
          const topic = data.subscriptions.get(id);
          if (topic) {
            subscriptionManager.unsubscribe(topic, id);
            data.subscriptions.delete(id);
          }
          break;
        }

        default:
          console.warn('[WS] unknown message type:', msg.type);
      }
    },

    close: async (ws, code) => {
      const { userId, initialized } = ws.getUserData();

      if (!initialized) {
        console.log(`[WS] uninitialized connection closed (${code})`);
        return;
      }

      // 清理该连接的所有订阅
      subscriptionManager.unsubscribeAll(ws);

      connectionManager.remove(userId, ws);
      if (!connectionManager.hasUser(userId)) {
        await redis.removeUserNode(userId);
      }
      console.log(`[WS] user ${userId} disconnected (${code}), total: ${connectionManager.size()}`);
    },
  });

  app.get('/health', (res) => {
    res.writeHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      status: 'ok',
      nodeId: config.server.nodeId,
      connections: connectionManager.size(),
      subscriptions: subscriptionManager.size(),
    }));
  });

  return app;
}
