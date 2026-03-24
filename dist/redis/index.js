"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.client = void 0;
exports.connect = connect;
exports.setUserNode = setUserNode;
exports.removeUserNode = removeUserNode;
exports.getUserNode = getUserNode;
exports.routeToNode = routeToNode;
exports.subscribeToRoutes = subscribeToRoutes;
const ioredis_1 = __importDefault(require("ioredis"));
const config_1 = __importDefault(require("../config"));
const client = new ioredis_1.default({
    host: config_1.default.redis.host,
    port: config_1.default.redis.port,
    password: config_1.default.redis.password,
    db: config_1.default.redis.db,
    lazyConnect: true,
});
exports.client = client;
// Pub/Sub 订阅需要独立连接，订阅后该连接不能再执行普通命令
const subscriber = new ioredis_1.default({
    host: config_1.default.redis.host,
    port: config_1.default.redis.port,
    password: config_1.default.redis.password,
    db: config_1.default.redis.db,
    lazyConnect: true,
});
client.on('error', (err) => console.error('[Redis] client error:', err.message));
subscriber.on('error', (err) => console.error('[Redis] subscriber error:', err.message));
async function connect() {
    await client.connect();
    await subscriber.connect();
    console.log('[Redis] connected');
}
async function setUserNode(userId) {
    await client.set(`${config_1.default.redis.userNodePrefix}${userId}`, config_1.default.server.nodeId, 'EX', 86400);
}
async function removeUserNode(userId) {
    await client.del(`${config_1.default.redis.userNodePrefix}${userId}`);
}
async function getUserNode(userId) {
    return client.get(`${config_1.default.redis.userNodePrefix}${userId}`);
}
async function routeToNode(nodeId, message) {
    await client.publish(`${config_1.default.redis.routeChannelPrefix}${nodeId}`, JSON.stringify(message));
}
async function subscribeToRoutes(handler) {
    const channel = `${config_1.default.redis.routeChannelPrefix}${config_1.default.server.nodeId}`;
    await subscriber.subscribe(channel);
    subscriber.on('message', (ch, data) => {
        if (ch !== channel)
            return;
        try {
            handler(JSON.parse(data));
        }
        catch (err) {
            console.error('[Redis] route message parse error:', err.message);
        }
    });
    console.log(`[Redis] subscribed to route channel: ${channel}`);
}
