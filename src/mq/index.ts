import type { PushMessage } from '../types';

export type MessageHandler = (message: PushMessage) => Promise<void>;

/**
 * MQ 消费者抽象接口
 * 后续换 Kafka 只需实现这个抽象类，其他代码不用改
 */
export abstract class MQConsumer {
  abstract connect(): Promise<void>;
  abstract subscribe(handler: MessageHandler): Promise<void>;
  abstract close(): Promise<void>;
}
