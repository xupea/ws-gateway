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
exports.subscribeToIngress = subscribeToIngress;
exports.close = close;
exports.isHealthy = isHealthy;
exports.ping = ping;
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
const routeSubscriber = new ioredis_1.default({
    host: config_1.default.redis.host,
    port: config_1.default.redis.port,
    password: config_1.default.redis.password,
    db: config_1.default.redis.db,
    lazyConnect: true,
});
const ingressSubscriber = new ioredis_1.default({
    host: config_1.default.redis.host,
    port: config_1.default.redis.port,
    password: config_1.default.redis.password,
    db: config_1.default.redis.db,
    lazyConnect: true,
});
client.on('error', (err) => console.error('[Redis] client error:', err.message));
routeSubscriber.on('error', (err) => console.error('[Redis] route subscriber error:', err.message));
ingressSubscriber.on('error', (err) => console.error('[Redis] ingress subscriber error:', err.message));
function isOpen(redis) {
    return redis.status === 'ready' || redis.status === 'connect' || redis.status === 'connecting';
}
async function connect() {
    await client.connect();
    await routeSubscriber.connect();
    await ingressSubscriber.connect();
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
    await routeSubscriber.subscribe(channel);
    routeSubscriber.on('message', (ch, data) => {
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
async function subscribeToIngress(handler) {
    const channel = config_1.default.redis.ingressChannel;
    await ingressSubscriber.subscribe(channel);
    ingressSubscriber.on('message', async (ch, data) => {
        if (ch !== channel)
            return;
        try {
            await handler(JSON.parse(data));
        }
        catch (err) {
            console.error('[Redis] ingress message handler error:', err.message);
        }
    });
    console.log(`[Redis] subscribed to ingress channel: ${channel}`);
}
async function close() {
    await Promise.allSettled([
        client.quit(),
        routeSubscriber.quit(),
        ingressSubscriber.quit(),
    ]);
}
function isHealthy() {
    return isOpen(client) && isOpen(routeSubscriber) && isOpen(ingressSubscriber);
}
async function ping() {
    try {
        return (await client.ping()) === 'PONG';
    }
    catch {
        return false;
    }
}
