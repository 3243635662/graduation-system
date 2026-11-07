import { API_PREFIX } from '@graduation/shared'

import type { CookieOptions } from '../utils/cookie.util.js'

/**
 * Refresh Token Cookie 配置
 *
 * - HttpOnly：前端 JS 无法读取，降低 XSS 窃取风险
 * - Path 限定到 /api/auth：登录、注册、刷新、退出共享，其他接口不携带
 * - SameSite=Lax 作为默认 CSRF 缓解
 *
 * 生产环境必须通过 HTTPS，并设置 COOKIE_SECURE=true。
 * 若确实需要跨站部署（SameSite=None），必须额外设计 CSRF Token 或 Origin 校验。
 */
export function getRefreshCookieOptions(): CookieOptions {
  const sameSite = (process.env['COOKIE_SAME_SITE'] ?? 'lax') as NonNullable<
    CookieOptions['sameSite']
  >

  return {
    httpOnly: true,
    secure: process.env['COOKIE_SECURE'] === 'true',
    sameSite,
    path: `/${API_PREFIX}/auth`,
    domain: process.env['COOKIE_DOMAIN'] || undefined,
  }
}
