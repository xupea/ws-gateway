import axios from 'axios';
import config from '../config';

const tokenClient = axios.create({
  baseURL: config.auth.tokenValidateUrl,
  timeout: config.auth.timeoutMs,
});

/**
 * 调 Java 接口验证 token（accessToken 或 lockdownToken）
 *
 * 接口约定（统一端点）：
 *   POST /internal/token/validate
 *   Body: { "accessToken": "xxx" } 或 { "lockdownToken": "xxx" }
 *   成功: 200
 *   失败: 401
 *
 * Gateway 只关心 token 是否有效，不持有 userId
 */
async function validateToken(payload: Record<string, string>): Promise<boolean> {
  try {
    await tokenClient.post('', payload);
    return true;
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 401) return false;
    console.error('[Auth] validate token error:', (err as Error).message);
    return false;
  }
}

/**
 * 验证 accessToken 或 lockdownToken（统一到同一个 Java 端点）
 * 优先级：accessToken > lockdownToken
 * @returns true 表示验证通过，false 表示验证失败
 */
export async function authenticateByToken(
  accessToken?: string,
  lockdownToken?: string,
): Promise<boolean> {
  if (config.auth.devBypass) {
    console.warn('[Auth] DEV_AUTH_BYPASS enabled — skipping real auth');
    return !!(accessToken || lockdownToken);
  }

  // 优先使用 accessToken（已登录用户）
  if (accessToken) {
    if (await validateToken({ accessToken })) return true;
  }

  // 其次使用 lockdownToken（未登录用户/游客）
  if (lockdownToken) {
    if (await validateToken({ lockdownToken })) return true;
  }

  return false;
}
