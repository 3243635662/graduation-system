import { describe, expect, it } from 'vitest'

import { parseCookie, serializeCookie } from './cookie.util.js'

describe('cookie.util', () => {
  it('序列化包含安全属性的 Cookie', () => {
    const cookie = serializeCookie('refresh_token', 'abc 123', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/api/auth',
      maxAge: 604800,
    })

    expect(cookie).toContain('refresh_token=abc%20123')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Path=/api/auth')
    expect(cookie).toContain('Max-Age=604800')
  })

  it('maxAge 为 0 时用于清除 Cookie', () => {
    const cookie = serializeCookie('refresh_token', '', { httpOnly: true, maxAge: 0 })
    expect(cookie).toContain('Max-Age=0')
  })

  it('从 Cookie 请求头中读取指定值', () => {
    const header = 'theme=dark; refresh_token=token-value; other=1'
    expect(parseCookie(header, 'refresh_token')).toBe('token-value')
  })

  it('对 URL 编码的值进行解码', () => {
    expect(parseCookie('refresh_token=a%2Fb%2Bc', 'refresh_token')).toBe('a/b+c')
  })

  it('缺失时返回 null', () => {
    expect(parseCookie(undefined, 'refresh_token')).toBeNull()
    expect(parseCookie('theme=dark', 'refresh_token')).toBeNull()
  })
})
