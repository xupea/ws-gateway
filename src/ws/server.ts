import uWS from 'uWebSockets.js';
import { authenticateByToken } from '../auth';
import * as connectionManager from '../connection/manager';
import * as redis from '../redis';
import config from '../config';
import type { WsUserData, ConnectionInitMessage } from '../types';

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
        { userId: '', user: null, initialized: false },
        secKey, secProtocol, secExtension,
        context,
      );
    },

    open: (ws) => {
      console.log('[WS] new connection established, waiting for connection_init');
    },

    message: async (ws, message) => {
      const data = ws.getUserData();
      const text = Buffer.from(message).toString();

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(text);
      } catch {
        return; // ignore malformed messages
      }

      // 未初始化时只接受 connection_init
      if (!data.initialized) {
        if (parsed.type !== 'connection_init') {
          ws.end(4400, 'connection_init required');
          return;
        }

        const { payload } = parsed as ConnectionInitMessage;
        const accessToken = payload?.accessToken;

        if (!accessToken) {
          ws.end(4400, 'missing accessToken');
          return;
        }

        const user = await authenticateByToken(accessToken);
        if (!user) {
          ws.end(4401, 'Unauthorized');
          return;
        }

        // 将认证信息写入连接数据
        data.userId = user.userId;
        data.user = user;
        data.initialized = true;

        connectionManager.add(user.userId, ws);
        await redis.setUserNode(user.userId);

        ws.send(JSON.stringify({ type: 'connection_ack' }));
        console.log(`[WS] user ${user.userId} initialized, total: ${connectionManager.size()}`);
        return;
      }

      // 已初始化，处理正常消息
      if (parsed.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
      }
    },

    close: async (ws, code) => {
      const { userId, initialized } = ws.getUserData();
      if (!initialized) {
        console.log(`[WS] uninitialized connection closed (${code})`);
        return;
      }
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
