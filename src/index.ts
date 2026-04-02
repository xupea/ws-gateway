import uWS from 'uWebSockets.js';
import config from './config';
import * as redis from './redis';
import { createServer } from './ws/server';
import * as connectionManager from './connection/manager';
import { dispatchTopicIngress, handleRouted } from './dispatcher';

async function main(): Promise<void> {
  await redis.connect();
  const deleted = await redis.cleanStaleUserNodes();
  if (deleted > 0) {
    console.log(`[Redis] cleaned ${deleted} stale user_node mappings for ${config.server.nodeId}`);
  }

  await redis.subscribeToTopics(dispatchTopicIngress);
  await redis.subscribeToRoutes(handleRouted);

  const state = { isDraining: false };
  const app = createServer(state);
  let listenSocket: uWS.us_listen_socket | null = null;
  let shuttingDown = false;
  const refreshTimer = setInterval(() => {
    const userIds = connectionManager.userIds();
    void redis.refreshOwnedUserNodes(userIds).catch((err) => {
      console.error('[Redis] refresh user_node TTL error:', (err as Error).message);
    });
  }, config.redis.userNodeRefreshIntervalMs);
  refreshTimer.unref();

  app.listen(config.server.port, (token) => {
    if (token) {
      listenSocket = token;
      console.log(`[Server] node ${config.server.nodeId} listening on port ${config.server.port}`);
    } else {
      console.error(`[Server] failed to listen on port ${config.server.port}`);
      process.exit(1);
    }
  });

  async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    state.isDraining = true;
    console.log('[Server] shutting down...');
    if (listenSocket) {
      uWS.us_listen_socket_close(listenSocket);
      listenSocket = null;
    }
    clearInterval(refreshTimer);
    await new Promise((resolve) => setTimeout(resolve, config.server.shutdownGraceMs));
    await redis.close();
    process.exit(0);
  }
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('[Server] startup error:', err);
  process.exit(1);
});
