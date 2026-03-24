import axios from 'axios';
import config from '../config';
import type { AuthUser } from '../types';

const httpClient = axios.create({
  baseURL: config.auth.validateUrl,
  timeout: config.auth.timeoutMs,
});

function extractSession(cookieHeader: string): string | null {
  const name = config.auth.sessionCookieName;
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
async function validateSession(session: string): Promise<AuthUser | null> {
  try {
    const res = await httpClient.post<AuthUser>('', { session });
    return res.data;
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 401) return null;
    console.error('[Auth] validate error:', (err as Error).message);
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
