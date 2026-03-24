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
const redis = __importStar(require("../redis"));
const config_1 = __importDefault(require("../config"));
function createServer() {
    const app = uWebSockets_js_1.default.App();
    app.ws('/ws', {
        maxPayloadLength: 16 * 1024,
        idleTimeout: 60,
        upgrade: async (res, req, context) => {
            // 异步处理前必须注册 onAborted，否则客户端提前断开会崩溃
            let aborted = false;
            res.onAborted(() => { aborted = true; });
            const cookieHeader = req.getHeader('cookie');
            const secKey = req.getHeader('sec-websocket-key');
            const secProtocol = req.getHeader('sec-websocket-protocol');
            const secExtension = req.getHeader('sec-websocket-extensions');
            const user = await (0, auth_1.authenticate)(cookieHeader);
            if (aborted)
                return;
            if (!user) {
                res.writeStatus('401 Unauthorized').end('Unauthorized');
                return;
            }
            res.upgrade({ userId: user.userId, user }, secKey, secProtocol, secExtension, context);
        },
        open: async (ws) => {
            const { userId } = ws.getUserData();
            connectionManager.add(userId, ws);
            await redis.setUserNode(userId);
            console.log(`[WS] user ${userId} connected, total: ${connectionManager.size()}`);
        },
        message: (ws, message) => {
            const text = Buffer.from(message).toString();
            try {
                const data = JSON.parse(text);
                if (data.type === 'ping') {
                    ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
                }
            }
            catch {
                // ignore malformed messages
            }
        },
        close: async (ws, code) => {
            const { userId } = ws.getUserData();
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
            nodeId: config_1.default.server.nodeId,
            connections: connectionManager.size(),
        }));
    });
    return app;
}
