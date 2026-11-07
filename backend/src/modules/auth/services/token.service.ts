import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'

import { Injectable, UnauthorizedException } from '@nestjs/common'

export interface AccessTokenPayload {
  /** 用户 ID */
  sub: string
  /** AuthSession ID */
  sid: string
  /** Token 唯一标识 */
  jti: string
  /** 签发时间（秒） */
  iat: number
  /** 过期时间（秒） */
  exp: number
}

const JWT_HEADER = { alg: 'HS256', typ: 'JWT' } as const

function encodeBase64Url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url')
}

function decodeBase64Url(input: string): Buffer {
  return Buffer.from(input, 'base64url')
}

/**
 * Token 服务
 *
 * - Access Token：HS256 签名的 JWT，默认 15 分钟有效
 * - Refresh Token：至少 32 字节随机数，数据库只保存 SHA-256 哈希
 *
 * 不依赖 @nestjs/jwt，直接使用 Node 内置 crypto，减少额外依赖。
 */
@Injectable()
export class TokenService {
  private readonly accessSecret: string
  private readonly accessTtlSeconds: number
  private readonly refreshTtlMs: number

  constructor() {
    const secret = process.env['JWT_ACCESS_SECRET']

    if (!secret) {
      throw new Error('缺少 JWT_ACCESS_SECRET 环境变量')
    }

    this.accessSecret = secret

    const accessTtl = Number(process.env['ACCESS_TOKEN_TTL_SECONDS'] ?? 900)
    this.accessTtlSeconds = Number.isFinite(accessTtl) && accessTtl > 0 ? accessTtl : 900

    const refreshDays = Number(process.env['REFRESH_TOKEN_TTL_DAYS'] ?? 7)
    const days = Number.isFinite(refreshDays) && refreshDays > 0 ? refreshDays : 7
    this.refreshTtlMs = days * 24 * 60 * 60 * 1000
  }

  /** 签发 Access Token */
  signAccessToken(userId: string, sessionId: string): string {
    const issuedAt = Math.floor(Date.now() / 1000)

    const payload: AccessTokenPayload = {
      sub: userId,
      sid: sessionId,
      jti: randomUUID(),
      iat: issuedAt,
      exp: issuedAt + this.accessTtlSeconds,
    }

    const header = encodeBase64Url(JSON.stringify(JWT_HEADER))
    const body = encodeBase64Url(JSON.stringify(payload))
    const signature = this.sign(`${header}.${body}`)

    return `${header}.${body}.${signature}`
  }

  /**
   * 校验 Access Token 的签名与有效期。
   *
   * 会话撤销、用户状态等「需要的会话状态」由 AccessTokenGuard 查询数据库确认。
   * 校验失败统一抛出 40101，前端据此触发静默刷新。
   */
  verifyAccessToken(token: string): AccessTokenPayload {
    const parts = token.split('.')

    if (parts.length !== 3) {
      throw this.invalidTokenError('登录凭证格式不正确')
    }

    const [header, body, signature] = parts as [string, string, string]
    const expected = this.sign(`${header}.${body}`)

    if (!this.safeEqual(expected, signature)) {
      throw this.invalidTokenError('登录凭证签名无效')
    }

    let payload: AccessTokenPayload

    try {
      payload = JSON.parse(decodeBase64Url(body).toString('utf8')) as AccessTokenPayload
    } catch {
      throw this.invalidTokenError('登录凭证内容无效')
    }

    if (
      typeof payload.exp !== 'number' ||
      typeof payload.sub !== 'string' ||
      typeof payload.sid !== 'string'
    ) {
      throw this.invalidTokenError('登录凭证内容不完整')
    }

    if (payload.exp * 1000 <= Date.now()) {
      throw this.invalidTokenError('登录凭证已过期')
    }

    return payload
  }

  /** 生成 Refresh Token 及其哈希 */
  generateRefreshToken(): { token: string; hash: string } {
    const token = randomBytes(32).toString('base64url')

    return { token, hash: this.hashRefreshToken(token) }
  }

  /** 计算 Refresh Token 的 SHA-256 哈希（64 位十六进制） */
  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex')
  }

  /** Refresh Token 有效期（毫秒） */
  getRefreshTtlMs(): number {
    return this.refreshTtlMs
  }

  private sign(data: string): string {
    return createHmac('sha256', this.accessSecret).update(data).digest('base64url')
  }

  /** 定长比较签名，避免时序侧信道 */
  private safeEqual(expected: string, provided: string): boolean {
    const expectedBuffer = decodeBase64Url(expected)
    const providedBuffer = decodeBase64Url(provided)

    if (expectedBuffer.length !== providedBuffer.length) return false

    return timingSafeEqual(expectedBuffer, providedBuffer)
  }

  private invalidTokenError(message: string): UnauthorizedException {
    return new UnauthorizedException({ code: 40101, data: null, message })
  }
}
