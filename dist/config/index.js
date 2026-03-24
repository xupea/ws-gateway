"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const config = {
    server: {
        port: parseInt(process.env.PORT ?? '3000'),
        nodeId: process.env.NODE_ID ?? `node-${process.pid}`,
    },
    auth: {
        validateUrl: process.env.AUTH_VALIDATE_URL ?? 'http://localhost:8080/internal/session/validate',
        sessionCookieName: process.env.SESSION_COOKIE_NAME ?? 'session',
        timeoutMs: parseInt(process.env.AUTH_TIMEOUT_MS ?? '3000'),
    },
    redis: {
        host: process.env.REDIS_HOST ?? '127.0.0.1',
        port: parseInt(process.env.REDIS_PORT ?? '6379'),
        password: process.env.REDIS_PASSWORD || undefined,
        db: parseInt(process.env.REDIS_DB ?? '0'),
        userNodePrefix: 'ws:user_node:',
        routeChannelPrefix: 'ws:route:',
    },
    rabbitmq: {
        url: process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672',
        queue: process.env.RABBITMQ_QUEUE ?? 'ws.push',
        prefetch: parseInt(process.env.RABBITMQ_PREFETCH ?? '100'),
    },
};
exports.default = config;
