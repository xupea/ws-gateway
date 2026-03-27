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
 * 调 Java 接口验证 accessToken（connection_init 方式）
 *
 * 接口约定（需和 Java 团队对齐）：
 *   POST /internal/token/validate
 *   Body: { "accessToken": "xxx" }
 *   成功: 200 { "userId": "123", ... }
 *   失败: 401
 */
async function validateToken(accessToken: string): Promise<AuthUser | null> {
  try {
    const res = await tokenClient.post<AuthUser>('', { accessToken });
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

export async function authenticateByToken(accessToken: string): Promise<AuthUser | null> {
  if (config.auth.devBypass) {
    console.warn('[Auth] DEV_AUTH_BYPASS enabled — skipping real auth');
    return { userId: accessToken };
  }

  return validateToken(accessToken);
}
