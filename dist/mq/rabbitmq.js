"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RabbitMQConsumer = void 0;
const amqplib_1 = __importDefault(require("amqplib"));
const index_1 = require("./index");
const config_1 = __importDefault(require("../config"));
class RabbitMQConsumer extends index_1.MQConsumer {
    constructor() {
        super(...arguments);
        this.connection = null;
        this.channel = null;
    }
    async connect() {
        this.connection = await amqplib_1.default.connect(config_1.default.rabbitmq.url);
        this.channel = await this.connection.createChannel();
        await this.channel.assertQueue(config_1.default.rabbitmq.queue, { durable: true });
        this.channel.prefetch(config_1.default.rabbitmq.prefetch);
        this.connection.on('error', (err) => {
            console.error('[RabbitMQ] connection error:', err.message);
        });
        this.connection.on('close', () => {
            console.warn('[RabbitMQ] connection closed, reconnecting in 5s...');
            setTimeout(() => this.connect(), 5000);
        });
        console.log(`[RabbitMQ] connected, queue: ${config_1.default.rabbitmq.queue}`);
    }
    async subscribe(handler) {
        if (!this.channel)
            throw new Error('RabbitMQ not connected');
        this.channel.consume(config_1.default.rabbitmq.queue, async (msg) => {
            if (!msg)
                return;
            try {
                const message = JSON.parse(msg.content.toString());
                await handler(message);
                this.channel.ack(msg);
            }
            catch (err) {
                console.error('[RabbitMQ] handler error:', err.message);
                this.channel.nack(msg, false, false);
            }
        });
    }
    async close() {
        await this.channel?.close();
        await this.connection?.close();
    }
}
exports.RabbitMQConsumer = RabbitMQConsumer;
