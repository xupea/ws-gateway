import amqplib, { ChannelModel, Channel } from 'amqplib';
import { MQConsumer, MessageHandler } from './index';
import config from '../config';

export class RabbitMQConsumer extends MQConsumer {
  private connection: ChannelModel | null = null;
  private channel: Channel | null = null;

  async connect(): Promise<void> {
    this.connection = await amqplib.connect(config.rabbitmq.url);
    this.channel = await this.connection.createChannel();

    await this.channel.assertQueue(config.rabbitmq.queue, { durable: true });
    this.channel.prefetch(config.rabbitmq.prefetch);

    this.connection.on('error', (err: Error) => {
      console.error('[RabbitMQ] connection error:', err.message);
    });
    this.connection.on('close', () => {
      console.warn('[RabbitMQ] connection closed, reconnecting in 5s...');
      setTimeout(() => this.connect(), 5000);
    });

    console.log(`[RabbitMQ] connected, queue: ${config.rabbitmq.queue}`);
  }

  async subscribe(handler: MessageHandler): Promise<void> {
    if (!this.channel) throw new Error('RabbitMQ not connected');

    this.channel.consume(config.rabbitmq.queue, async (msg) => {
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
