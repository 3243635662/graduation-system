/**
 * 轻量 Cookie 工具
 *
 * 项目未引入 cookie-parser，这里仅实现单个 Refresh Token Cookie 的读写，
 * 避免为一个小功能增加中间件依赖。
 */

export const REFRESH_TOKEN_COOKIE = 'refresh_token'

export interface CookieOptions {
  httpOnly?: boolean
  secure?: boolean
  sameSite?: 'strict' | 'lax' | 'none'
  path?: string
  /** 有效期（秒），0 表示立即过期（用于清除） */
  maxAge?: number
  domain?: string
}

const SAME_SITE_LABELS: Record<NonNullable<CookieOptions['sameSite']>, string> = {
  strict: 'Strict',
  lax: 'Lax',
  none: 'None',
}

/** 序列化 Set-Cookie 头 */
export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  const segments = [`${name}=${encodeURIComponent(value)}`]

  if (options.httpOnly) segments.push('HttpOnly')
  if (options.secure) segments.push('Secure')
  if (options.sameSite) segments.push(`SameSite=${SAME_SITE_LABELS[options.sameSite]}`)
  if (options.path) segments.push(`Path=${options.path}`)
  if (options.domain) segments.push(`Domain=${options.domain}`)
  if (options.maxAge !== undefined)
    segments.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`)

  return segments.join('; ')
}

/** 从 Cookie 请求头中读取指定 Cookie */
export function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null

  for (const segment of header.split(';')) {
    const trimmed = segment.trim()
    if (!trimmed) continue

    const separatorIndex = trimmed.indexOf('=')

    if (separatorIndex === -1) continue

    const key = trimmed.slice(0, separatorIndex)

    if (key === name) {
      const value = trimmed.slice(separatorIndex + 1)

      try {
        return decodeURIComponent(value)
      } catch {
        return value
      }
    }
  }

  return null
}
