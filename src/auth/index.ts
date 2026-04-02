import axios from 'axios';
import config from '../config';
import type { AuthUser } from '../types';

const sessionClient = axios.create({
  baseURL: config.auth.validateUrl,
  timeout: config.auth.timeoutMs,
});

const tokenClient = axios.create({
  baseURL: config.auth.tokenValidateUrl,
  timeout: config.auth.timeoutMs,
});

// ── 认证结果缓存 ──────────────────────────────────────────────────────────────
// 避免高并发重连时（如节点滚动更新）大量请求同时冲击 Java 认证服务。
// 只缓存成功结果；401 不缓存，确保无效 token 能被及时拒绝。
// 注意：缓存期间（默认 30s）内 Token 被吊销的连接仍可建立，
//       但已建立连接可通过业务侧推送 force_logout 事件来处理。
interface CacheEntry {
  user: AuthUser;
  expiresAt: number;
}
const authCache = new Map<string, CacheEntry>();

function getCached(token: string): AuthUser | null {
  const entry = authCache.get(token);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    authCache.delete(token);
    return null;
  }
  return entry.user;
}

function setCached(token: string, user: AuthUser): void {
  // 超出上限时，淘汰最旧的一条（Map 按插入顺序迭代）
  if (authCache.size >= config.auth.cacheMaxSize) {
    const oldestKey = authCache.keys().next().value;
    if (oldestKey !== undefined) authCache.delete(oldestKey);
  }
  authCache.set(token, { user, expiresAt: Date.now() + config.auth.cacheTtlMs });
}
// ─────────────────────────────────────────────────────────────────────────────

function extractSession(cookieHeader: string): string | null {
  const name = config.auth.sessionCookieName;
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
async function validateSession(session: string): Promise<AuthUser | null> {
  try {
    const res = await sessionClient.post<AuthUser>('', { session });
    return res.data;
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 401) return null;
    console.error('[Auth] validate session error:', (err as Error).message);
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
async function validateToken(payload: Record<string, string>): Promise<AuthUser | null> {
  try {
    const res = await tokenClient.post<AuthUser>('', payload);
    return res.data;
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 401) return null;
    console.error('[Auth] validate token error:', (err as Error).message);
    return null;
  }
}

export async function authenticate(cookieHeader: string): Promise<AuthUser | null> {
  const session = extractSession(cookieHeader);
  if (!session) return null;

  if (config.auth.devBypass) {
    console.warn('[Auth] DEV_AUTH_BYPASS enabled — skipping real auth');
    return { userId: session };
  }

  return validateSession(session);
}

/**
 * 验证 accessToken 或 lockdownToken（统一到同一个 Java 端点）
 * 优先级：accessToken > lockdownToken
 * 验证结果缓存 cacheTtlMs（默认 30s），减少 Java 认证服务压力。
 */
export async function authenticateByToken(
  accessToken?: string,
  lockdownToken?: string,
): Promise<AuthUser | null> {
  if (config.auth.devBypass) {
    console.warn('[Auth] DEV_AUTH_BYPASS enabled — skipping real auth');
    const token = accessToken || lockdownToken;
    return token ? { userId: token } : null;
  }

  // 优先使用 accessToken（已登录用户）
  if (accessToken) {
    const cached = getCached(accessToken);
    if (cached) return cached;

    const user = await validateToken({ accessToken });
    if (user) {
      setCached(accessToken, user);
      return user;
    }
  }

  // 其次使用 lockdownToken（未登录用户/游客）
  if (lockdownToken) {
    const cached = getCached(lockdownToken);
    if (cached) return cached;

    const user = await validateToken({ lockdownToken });
    if (user) {
      setCached(lockdownToken, user);
      return user;
    }
  }

  return null;
}
