"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.client = void 0;
exports.connect = connect;
exports.setUserNode = setUserNode;
exports.removeUserNode = removeUserNode;
exports.removeUserNodeIfOwner = removeUserNodeIfOwner;
exports.getUserNode = getUserNode;
exports.routeToNode = routeToNode;
exports.refreshOwnedUserNodes = refreshOwnedUserNodes;
exports.cleanStaleUserNodes = cleanStaleUserNodes;
exports.subscribeToRoutes = subscribeToRoutes;
exports.subscribeToTopics = subscribeToTopics;
exports.close = close;
exports.isHealthy = isHealthy;
exports.ping = ping;
const ioredis_1 = __importDefault(require("ioredis"));
const config_1 = __importDefault(require("../config"));
const refreshOwnedUserNodeScript = `
  if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
  end
  return 0
`;
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
function parseMessage(data) {
    try {
        return JSON.parse(data);
    }
    catch (err) {
        console.error('[Redis] message parse error:', err.message);
        return null;
    }
}
async function connect() {
    await client.connect();
    await routeSubscriber.connect();
    await ingressSubscriber.connect();
    console.log('[Redis] connected');
}
async function setUserNode(userId) {
    await client.set(`${config_1.default.redis.userNodePrefix}${userId}`, config_1.default.server.nodeId, 'EX', config_1.default.redis.userNodeTtlSec);
}
async function removeUserNode(userId) {
    await client.del(`${config_1.default.redis.userNodePrefix}${userId}`);
}
/**
 * 仅当 Redis 中存储的 nodeId 仍为本节点时才删除。
 *
 * 用于 close handler：若用户已在其他节点重新登录，Redis 已被新节点更新，
 * 此时不应删除，否则会使新连接的路由失效。
 */
async function removeUserNodeIfOwner(userId) {
    const current = await client.get(`${config_1.default.redis.userNodePrefix}${userId}`);
    if (current === config_1.default.server.nodeId) {
        await client.del(`${config_1.default.redis.userNodePrefix}${userId}`);
    }
}
async function getUserNode(userId) {
    return client.get(`${config_1.default.redis.userNodePrefix}${userId}`);
}
async function routeToNode(nodeId, message) {
    await client.publish(`${config_1.default.redis.routeChannelPrefix}${nodeId}`, JSON.stringify(message));
}
async function refreshOwnedUserNodes(userIds) {
    if (userIds.length === 0)
        return;
    const pipeline = client.pipeline();
    for (const userId of userIds) {
        pipeline.eval(refreshOwnedUserNodeScript, 1, `${config_1.default.redis.userNodePrefix}${userId}`, config_1.default.server.nodeId, String(config_1.default.redis.userNodeTtlSec));
    }
    await pipeline.exec();
}
async function cleanStaleUserNodes(ownerNodeId = config_1.default.server.nodeId) {
    let cursor = '0';
    let deleted = 0;
    const pattern = `${config_1.default.redis.userNodePrefix}*`;
    do {
        const [nextCursor, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
        cursor = nextCursor;
        if (keys.length === 0)
            continue;
        const pipeline = client.pipeline();
        for (const key of keys)
            pipeline.get(key);
        const results = await pipeline.exec();
        if (!results)
            continue;
        const keysToDelete = [];
        for (let i = 0; i < keys.length; i += 1) {
            const [, value] = results[i] ?? [];
            if (value === ownerNodeId)
                keysToDelete.push(keys[i]);
        }
        if (keysToDelete.length > 0) {
            deleted += keysToDelete.length;
            await client.del(...keysToDelete);
        }
    } while (cursor !== '0');
    return deleted;
}
async function subscribeToRoutes(handler) {
    const channel = `${config_1.default.redis.routeChannelPrefix}${config_1.default.server.nodeId}`;
    await routeSubscriber.subscribe(channel);
    routeSubscriber.on('message', (ch, data) => {
        if (ch !== channel)
            return;
        const parsed = parseMessage(data);
        if (parsed)
            handler(parsed);
    });
    console.log(`[Redis] subscribed to route channel: ${channel}`);
}
async function subscribeToTopics(handler) {
    const pattern = `${config_1.default.redis.topicChannelPrefix}*`;
    await ingressSubscriber.psubscribe(pattern);
    ingressSubscriber.on('pmessage', (_pattern, channel, data) => {
        if (!channel.startsWith(config_1.default.redis.topicChannelPrefix))
            return;
        const parsed = parseMessage(data);
        if (!parsed)
            return;
        if (parsed.type === 'topic' && !parsed.topic) {
            parsed.topic = channel.slice(config_1.default.redis.topicChannelPrefix.length);
        }
        handler(parsed);
    });
    console.log(`[Redis] subscribed to topic pattern: ${pattern}`);
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
