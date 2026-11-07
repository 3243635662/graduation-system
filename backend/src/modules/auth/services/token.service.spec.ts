import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TokenService } from './token.service.js'

describe('TokenService', () => {
  beforeEach(() => {
    process.env['JWT_ACCESS_SECRET'] = 'unit-test-secret'
    process.env['ACCESS_TOKEN_TTL_SECONDS'] = '900'
    process.env['REFRESH_TOKEN_TTL_DAYS'] = '7'
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('签发的 Access Token 可以被验证并解析出身份信息', () => {
    const service = new TokenService()
    const token = service.signAccessToken('user-1', 'session-1')
    const payload = service.verifyAccessToken(token)

    expect(payload.sub).toBe('user-1')
    expect(payload.sid).toBe('session-1')
    expect(payload.jti).toBeTruthy()
    expect(payload.exp - payload.iat).toBe(900)
  })

  it('被篡改的 Access Token 会被拒绝', () => {
    const service = new TokenService()
    const token = service.signAccessToken('user-1', 'session-1')
    const [header, body, signature] = token.split('.')

    const tampered = `${header}.${body}.${signature?.slice(0, -1)}x`

    expect(() => service.verifyAccessToken(tampered)).toThrowError(/签名无效/)
  })

  it('格式非法的 Access Token 会被拒绝', () => {
    const service = new TokenService()
    expect(() => service.verifyAccessToken('not-a-jwt')).toThrowError(/格式不正确/)
  })

  it('过期的 Access Token 会被拒绝', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const service = new TokenService()
    const token = service.signAccessToken('user-1', 'session-1')

    vi.setSystemTime(new Date('2026-01-01T00:16:00Z'))

    expect(() => service.verifyAccessToken(token)).toThrowError(/已过期/)
  })

  it('Refresh Token 只保存 SHA-256 哈希（64 位十六进制）', () => {
    const service = new TokenService()
    const { token, hash } = service.generateRefreshToken()

    expect(token).toBeTruthy()
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(service.hashRefreshToken(token)).toBe(hash)
    expect(hash).not.toBe(token)
  })

  it('每次生成的 Refresh Token 都不同', () => {
    const service = new TokenService()
    const first = service.generateRefreshToken()
    const second = service.generateRefreshToken()

    expect(first.token).not.toBe(second.token)
    expect(first.hash).not.toBe(second.hash)
  })

  it('缺少 JWT_ACCESS_SECRET 时构造失败', () => {
    delete process.env['JWT_ACCESS_SECRET']
    expect(() => new TokenService()).toThrowError(/JWT_ACCESS_SECRET/)
  })
})
