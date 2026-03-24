import config from './config';
import * as redis from './redis';
import { RabbitMQConsumer } from './mq/rabbitmq';
import { createServer } from './ws/server';
import { dispatch, handleRouted } from './dispatcher';

async function main(): Promise<void> {
  await redis.connect();
  await redis.subscribeToRoutes(handleRouted);

  const mq = new RabbitMQConsumer();
  await mq.connect();
  await mq.subscribe(dispatch);

  const app = createServer();
  app.listen(config.server.port, (token) => {
    if (token) {
      console.log(`[Server] node ${config.server.nodeId} listening on port ${config.server.port}`);
    } else {
      console.error(`[Server] failed to listen on port ${config.server.port}`);
      process.exit(1);
    }
  });

  async function shutdown(): Promise<void> {
    console.log('[Server] shutting down...');
    await mq.close();
    process.exit(0);
  }
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('[Server] startup error:', err);
  process.exit(1);
});
