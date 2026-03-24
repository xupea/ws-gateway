import uWS from 'uWebSockets.js';
import { authenticate } from '../auth';
import * as connectionManager from '../connection/manager';
import * as redis from '../redis';
import config from '../config';
import type { WsUserData } from '../types';

export function createServer(): uWS.TemplatedApp {
  const app = uWS.App();

  app.ws<WsUserData>('/ws', {
    maxPayloadLength: 16 * 1024,
    idleTimeout: 60,

    upgrade: async (res, req, context) => {
      // 异步处理前必须注册 onAborted，否则客户端提前断开会崩溃
      let aborted = false;
      res.onAborted(() => { aborted = true; });

      const cookieHeader = req.getHeader('cookie');
      const secKey = req.getHeader('sec-websocket-key');
      const secProtocol = req.getHeader('sec-websocket-protocol');
      const secExtension = req.getHeader('sec-websocket-extensions');

      const user = await authenticate(cookieHeader);

      if (aborted) return;

      if (!user) {
        res.writeStatus('401 Unauthorized').end('Unauthorized');
        return;
      }

      res.upgrade<WsUserData>(
        { userId: user.userId, user },
        secKey, secProtocol, secExtension,
        context,
      );
    },

    open: async (ws) => {
      const { userId } = ws.getUserData();
      connectionManager.add(userId, ws);
      await redis.setUserNode(userId);
      console.log(`[WS] user ${userId} connected, total: ${connectionManager.size()}`);
    },

    message: (ws, message) => {
      const text = Buffer.from(message).toString();
      try {
        const data = JSON.parse(text);
        if (data.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
        }
      } catch {
        // ignore malformed messages
      }
    },

    close: async (ws, code) => {
      const { userId } = ws.getUserData();
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
    }));
  });

  return app;
}
