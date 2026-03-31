"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticate = authenticate;
exports.authenticateByToken = authenticateByToken;
const axios_1 = __importDefault(require("axios"));
const config_1 = __importDefault(require("../config"));
const sessionClient = axios_1.default.create({
    baseURL: config_1.default.auth.validateUrl,
    timeout: config_1.default.auth.timeoutMs,
});
const tokenClient = axios_1.default.create({
    baseURL: config_1.default.auth.tokenValidateUrl,
    timeout: config_1.default.auth.timeoutMs,
});
function extractSession(cookieHeader) {
    const name = config_1.default.auth.sessionCookieName;
    const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
    return match ? decodeURIComponent(match[1]) : null;
}
/**
 * 调 Java 接口验证 session（Cookie 方式，保留备用）
 *
 * POST /internal/session/validate
 * Body: { "session": "xxx" }
 * 成功: 200 { "userId": "123", ... }  失败: 401
 */
async function validateSession(session) {
    try {
        const res = await sessionClient.post('', { session });
        return res.data;
    }
    catch (err) {
        if (axios_1.default.isAxiosError(err) && err.response?.status === 401)
            return null;
        console.error('[Auth] validate session error:', err.message);
        return null;
    }
}
/**
 * 调 Java 接口验证 token（accessToken 或 lockdownToken）
 *
 * 接口约定（统一端点）：
 *   POST /internal/token/validate
 *   Body: { "accessToken": "xxx" } 或 { "lockdownToken": "xxx" }
 *   成功: 200 { "userId": "123", ... }
 *   失败: 401
 */
async function validateToken(payload) {
    try {
        const res = await tokenClient.post('', payload);
        return res.data;
    }
    catch (err) {
        if (axios_1.default.isAxiosError(err) && err.response?.status === 401)
            return null;
        console.error('[Auth] validate token error:', err.message);
        return null;
    }
}
async function authenticate(cookieHeader) {
    const session = extractSession(cookieHeader);
    if (!session)
        return null;
    if (config_1.default.auth.devBypass) {
        console.warn('[Auth] DEV_AUTH_BYPASS enabled — skipping real auth');
        return { userId: session };
    }
    return validateSession(session);
}
/**
 * 验证 accessToken 或 lockdownToken（统一到同一个 Java 端点）
 * 优先级：accessToken > lockdownToken
 */
async function authenticateByToken(accessToken, lockdownToken) {
    if (config_1.default.auth.devBypass) {
        console.warn('[Auth] DEV_AUTH_BYPASS enabled — skipping real auth');
        const token = accessToken || lockdownToken;
        return token ? { userId: token } : null;
    }
    // 优先使用 accessToken（已登录用户）
    if (accessToken) {
        const user = await validateToken({ accessToken });
        if (user)
            return user;
    }
    // 其次使用 lockdownToken（未登录用户/游客）
    if (lockdownToken) {
        const user = await validateToken({ lockdownToken });
        if (user)
            return user;
    }
    return null;
}
