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
const config_1 = __importDefault(require("./config"));
const redis = __importStar(require("./redis"));
const rabbitmq_1 = require("./mq/rabbitmq");
const server_1 = require("./ws/server");
const dispatcher_1 = require("./dispatcher");
async function main() {
    await redis.connect();
    await redis.subscribeToRoutes(dispatcher_1.handleRouted);
    const mq = new rabbitmq_1.RabbitMQConsumer();
    await mq.connect();
    await mq.subscribe(dispatcher_1.dispatch);
    const app = (0, server_1.createServer)();
    app.listen(config_1.default.server.port, (token) => {
        if (token) {
            console.log(`[Server] node ${config_1.default.server.nodeId} listening on port ${config_1.default.server.port}`);
        }
        else {
            console.error(`[Server] failed to listen on port ${config_1.default.server.port}`);
            process.exit(1);
        }
    });
    async function shutdown() {
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
