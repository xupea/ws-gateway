import amqplib, { ChannelModel, Channel } from 'amqplib';
import { MQConsumer, MessageHandler } from './index';
import config from '../config';

export class RabbitMQConsumer extends MQConsumer {
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;

  async connect(): Promise<void> {
    this.connection = await amqplib.connect(config.rabbitmq.url);
    this.channel = await this.connection.createChannel();

    // 声明 consistent-hash exchange
    // Java 发消息时 routing key = userId，RabbitMQ 按 hash(userId) 路由到对应节点队列
    await this.channel.assertExchange('stake.topic', 'x-consistent-hash', { durable: true });

    // 每个节点声明自己的专属队列，设置消息 TTL 防止节点宕机时过期消息堆积
    const perNodeQueue = `${config.rabbitmq.queue}.${config.server.nodeId}`;
    await this.channel.assertQueue(perNodeQueue, {
      durable: true,
      arguments: {
        'x-message-ttl': config.rabbitmq.messageTtlMs,  // 消息超时自动丢弃（押注场景关键）
      },
    });

    // 绑定到 exchange，routing key 为权重字符串，所有节点权重相同保证均匀分配
    await this.channel.bindQueue(perNodeQueue, 'stake.topic', config.rabbitmq.bindingWeight);

    this.channel.prefetch(config.rabbitmq.prefetch);

    this.connection.on('error', (err: Error) => {
      console.error('[RabbitMQ] connection error:', err.message);
    });
    this.connection.on('close', () => {
      console.warn('[RabbitMQ] connection closed, reconnecting in 5s...');
      setTimeout(() => this.connect(), 5000);
    });

    console.log(`[RabbitMQ] connected, exchange: stake.topic (x-consistent-hash), queue: ${perNodeQueue}, ttl: ${config.rabbitmq.messageTtlMs}ms`);
  }

  async subscribe(handler: MessageHandler): Promise<void> {
    if (!this.channel) throw new Error('RabbitMQ not connected');

    const perNodeQueue = `${config.rabbitmq.queue}.${config.server.nodeId}`;
    this.channel.consume(perNodeQueue, async (msg) => {
      if (!msg) return;
      try {
        const message = JSON.parse(msg.content.toString());
        await handler(message);
        this.channel!.ack(msg);
      } catch (err) {
        console.error('[RabbitMQ] handler error:', (err as Error).message);
        this.channel!.nack(msg, false, false);
      }
    });
  }

  async close(): Promise<void> {
    await this.channel?.close();
    await this.connection?.close();
  }
}
