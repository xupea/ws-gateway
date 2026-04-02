"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.add = add;
exports.remove = remove;
exports.sendToUser = sendToUser;
exports.hasUser = hasUser;
exports.closeUser = closeUser;
exports.size = size;
exports.userIds = userIds;
exports.__resetForTests = __resetForTests;
// userId → Set<WebSocket>（同一用户可能多个 tab 同时连接）
const connections = new Map();
function add(userId, ws) {
    if (!connections.has(userId)) {
        connections.set(userId, new Set());
    }
    connections.get(userId).add(ws);
}
function remove(userId, ws) {
    const sockets = connections.get(userId);
    if (!sockets)
        return;
    sockets.delete(ws);
    if (sockets.size === 0)
        connections.delete(userId);
}
/**
 * 向本节点的指定用户推送消息
 * @returns 是否找到该用户的连接
 */
function sendToUser(userId, message) {
    const sockets = connections.get(userId);
    if (!sockets || sockets.size === 0)
        return false;
    const data = JSON.stringify(message);
    for (const ws of sockets) {
        try {
            ws.send(data);
        }
        catch (err) {
            console.error(`[Connection] send to user ${userId} error:`, err.message);
        }
    }
    return true;
}
function hasUser(userId) {
    const sockets = connections.get(userId);
    return !!sockets && sockets.size > 0;
}
/**
 * 关闭指定用户在本节点的所有连接（互踢使用）
 * close 事件会异步触发，由 close handler 完成后续 connectionManager / Redis 清理
 */
function closeUser(userId, code, reason) {
    const sockets = connections.get(userId);
    if (!sockets)
        return;
    // 复制一份再遍历，避免 ws.end() 触发 close 时修改正在迭代的 Set
    for (const ws of [...sockets]) {
        try {
            ws.end(code, reason);
        }
        catch {
            // ignore
        }
    }
}
function size() {
    let count = 0;
    for (const sockets of connections.values())
        count += sockets.size;
    return count;
}
function userIds() {
    return [...connections.keys()];
}
function __resetForTests() {
    connections.clear();
}
