"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticate = authenticate;
const axios_1 = __importDefault(require("axios"));
const config_1 = __importDefault(require("../config"));
const httpClient = axios_1.default.create({
    baseURL: config_1.default.auth.validateUrl,
    timeout: config_1.default.auth.timeoutMs,
});
function extractSession(cookieHeader) {
    const name = config_1.default.auth.sessionCookieName;
    const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
    return match ? decodeURIComponent(match[1]) : null;
}
/**
 * 调 Java 接口验证 session
 *
 * 接口约定（需和 Java 团队对齐）：
 *   POST /internal/session/validate
 *   Body: { "session": "xxx" }
 *   成功: 200 { "userId": "123", ... }
 *   失败: 401
 */
async function validateSession(session) {
    try {
        const res = await httpClient.post('', { session });
        return res.data;
    }
    catch (err) {
        if (axios_1.default.isAxiosError(err) && err.response?.status === 401)
            return null;
        console.error('[Auth] validate error:', err.message);
        return null;
    }
}
async function authenticate(cookieHeader) {
    const session = extractSession(cookieHeader);
    if (!session)
        return null;
    return validateSession(session);
}
