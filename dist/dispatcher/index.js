"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.dispatch = dispatch;
exports.handleRouted = handleRouted;
const redis = __importStar(require("../redis"));
const connectionManager = __importStar(require("../connection/manager"));
async function dispatch(message) {
    if (message.type === 'broadcast') {
        return dispatchBroadcast(message);
    }
    if (message.type === 'user') {
        return dispatchToUser(message);
    }
    console.warn('[Dispatcher] unknown message type:', message.type);
}
async function dispatchToUser(message) {
    const { userId } = message;
    // 用户在本节点，直接推
    if (connectionManager.hasUser(userId)) {
        connectionManager.sendToUser(userId, message);
        return;
    }
    // 查 Redis 找用户在哪个节点
    const targetNodeId = await redis.getUserNode(userId);
    if (!targetNodeId) {
        console.debug(`[Dispatcher] user ${userId} is offline, message dropped`);
        return;
    }
    // 转发给目标节点
    await redis.routeToNode(targetNodeId, message);
}
function dispatchBroadcast(message) {
    // 广播：本节点推给所有连接
    // 所有节点都消费同一条 MQ 广播消息，各自广播给自己的连接
    connectionManager.broadcast(message);
}
/**
 * 处理从 Redis Pub/Sub 路由过来的消息（其他节点转发来的）
 */
function handleRouted(message) {
    if (message.type === 'broadcast') {
        connectionManager.broadcast(message);
        return;
    }
    if (message.type === 'user') {
        connectionManager.sendToUser(message.userId, message);
    }
}
