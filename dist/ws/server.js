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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createServer = createServer;
const uWebSockets_js_1 = __importDefault(require("uWebSockets.js"));
const auth_1 = require("../auth");
const connectionManager = __importStar(require("../connection/manager"));
const subscriptionManager = __importStar(require("../subscription/manager"));
const redis = __importStar(require("../redis"));
const config_1 = __importDefault(require("../config"));
function createServer(state) {
    const app = uWebSockets_js_1.default.App();
    app.ws('/ws', {
        maxPayloadLength: 16 * 1024,
        idleTimeout: config_1.default.server.wsIdleTimeout,
        upgrade: (res, req, context) => {
            if (state.isDraining) {
                res.writeStatus('503 Service Unavailable');
                res.end('server draining');
                return;
            }
            const secKey = req.getHeader('sec-websocket-key');
            const secProtocol = req.getHeader('sec-websocket-protocol');
            const secExtension = req.getHeader('sec-websocket-extensions');
            // 不在握手阶段做认证，等待客户端发送 connection_init
            res.upgrade({ userId: '', user: null, initialized: false, subscriptions: new Map() }, secKey, secProtocol, secExtension, context);
        },
        open: (_ws) => {
            console.log('[WS] new connection established, waiting for connection_init');
        },
        message: async (ws, message) => {
            const data = ws.getUserData();
            const text = Buffer.from(message).toString();
            let parsed;
            try {
                parsed = JSON.parse(text);
            }
            catch {
                return; // ignore malformed messages
            }
            const msg = parsed;
            // ── 1. 未初始化：只接受 connection_init ──────────────────────────────
            if (!data.initialized) {
                if (msg.type !== 'connection_init') {
                    ws.end(4400, 'connection_init required');
                    return;
                }
                const { payload } = parsed;
                const accessToken = payload?.accessToken;
                const lockdownToken = payload?.lockdownToken;
                if (!accessToken && !lockdownToken) {
                    ws.end(4400, 'missing accessToken or lockdownToken');
                    return;
                }
                const user = await (0, auth_1.authenticateByToken)(accessToken, lockdownToken);
                if (!user) {
                    ws.end(4401, 'Unauthorized');
                    return;
                }
                data.userId = user.userId;
                data.user = user;
                data.initialized = true;
                connectionManager.add(user.userId, ws);
                await redis.setUserNode(user.userId);
                ws.send(JSON.stringify({ type: 'connection_ack' }));
                console.log(`[WS] user ${user.userId} initialized, total: ${connectionManager.size()}`);
                return;
            }
            // ── 2. 已初始化：处理各类消息 ─────────────────────────────────────────
            switch (msg.type) {
                case 'ping': {
                    ws.send(JSON.stringify({ type: 'pong' }));
                    break;
                }
                case 'subscribe': {
                    const { id, payload: topic } = parsed;
                    if (!id || typeof topic !== 'string') {
                        console.warn('[WS] invalid subscribe message, ignored');
                        return;
                    }
                    // 验证 topic 是否支持
                    const success = subscriptionManager.subscribe(topic, id, ws);
                    if (!success) {
                        // 返回错误响应
                        ws.send(JSON.stringify({
                            id,
                            type: 'error',
                            payload: { message: `unsupported topic: ${topic}` }
                        }));
                    }
                    break;
                }
                case 'complete': {
                    const { id } = parsed;
                    if (!id)
                        return;
                    const topic = data.subscriptions.get(id);
                    if (topic) {
                        subscriptionManager.unsubscribe(topic, id);
                        data.subscriptions.delete(id);
                    }
                    break;
                }
                default:
                    console.warn('[WS] unknown message type:', msg.type);
            }
        },
        close: async (ws, code) => {
            const { userId, initialized } = ws.getUserData();
            if (!initialized) {
                console.log(`[WS] uninitialized connection closed (${code})`);
                return;
            }
            // 清理该连接的所有订阅
            subscriptionManager.unsubscribeAll(ws);
            connectionManager.remove(userId, ws);
            if (!connectionManager.hasUser(userId)) {
                await redis.removeUserNode(userId);
            }
            console.log(`[WS] user ${userId} disconnected (${code}), total: ${connectionManager.size()}`);
        },
    });
    app.get('/health', (res) => {
        const healthy = !state.isDraining && redis.isHealthy();
        res.writeStatus(healthy ? '200 OK' : '503 Service Unavailable');
        res.writeHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
            status: healthy ? 'ok' : 'degraded',
            nodeId: config_1.default.server.nodeId,
            redis: healthy ? 'ok' : 'unavailable',
            draining: state.isDraining,
            connections: connectionManager.size(),
            subscriptions: subscriptionManager.size(),
        }));
    });
    app.get('/ready', async (res) => {
        const healthy = !state.isDraining && await redis.ping();
        res.writeStatus(healthy ? '200 OK' : '503 Service Unavailable');
        res.writeHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
            status: healthy ? 'ready' : 'not_ready',
            nodeId: config_1.default.server.nodeId,
            draining: state.isDraining,
        }));
    });
    return app;
}
