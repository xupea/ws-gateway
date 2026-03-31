"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SUPPORTED_TOPICS = void 0;
// 支持的 WebSocket topics 列表（必须与 Java 端对齐）
exports.SUPPORTED_TOPICS = [
    'ws.available-balances',
    'ws.vault-balances',
    'ws.highroller-house-bets',
    'ws.announcements',
    'ws.race-status',
    'ws.feature-flag',
    'ws.notifications',
    'ws.house-bets',
    'ws.deposit-bonus-transaction',
];
