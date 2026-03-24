"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.add = add;
exports.remove = remove;
exports.sendToUser = sendToUser;
exports.broadcast = broadcast;
exports.hasUser = hasUser;
exports.size = size;
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
function broadcast(message) {
    const data = JSON.stringify(message);
    for (const sockets of connections.values()) {
        for (const ws of sockets) {
            try {
                ws.send(data);
            }
            catch {
                // ignore individual send errors
            }
        }
    }
}
function hasUser(userId) {
    const sockets = connections.get(userId);
    return !!sockets && sockets.size > 0;
}
function size() {
    let count = 0;
    for (const sockets of connections.values())
        count += sockets.size;
    return count;
}
