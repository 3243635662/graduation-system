import { randomBytes, timingSafeEqual } from 'node:crypto'

import type { AuthUser } from '@graduation/shared'
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common'
import * as argon2 from 'argon2'

import { createRedisUnavailableError, RedisService } from '../../../common/redis/redis.service.js'
import { PrismaService } from '../../../prisma/prisma.service.js'
import { AuthService } from '../auth.service.js'
import { loadEmailCodeConfig } from '../email-code/email-code.config.js'
import { hashEmailChangeToken, hashIdentifier } from '../email-code/email-code.crypto.js'
import { EmailCodeService } from '../email-code/email-code.service.js'

/** 换绑令牌与流程状态错误码 */
export const EMAIL_CHANGE_ERROR_CODE = {
  /** 流程状态不正确（未解绑、已完成等） */
  INVALID_STAGE: 40014,
  /** 令牌无效 */
  INVALID_TOKEN: 40015,
} as const

/** 同一用户最多保留一个换绑流程，令牌与状态一起过期 */
const EMAIL_CHANGE_TTL_SECONDS = 10 * 60
const KEY_PREFIX = 'auth:email-change'

const STAGE_PENDING_UNBIND = 'PENDING_UNBIND'
const STAGE_UNBOUND = 'UNBOUND'

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)

  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * 邮箱换绑流程服务
 *
 * 步骤：验证当前密码 → 解绑原邮箱 → 向新邮箱发码 → 校验并绑定。
 * 密码验证成功后发放短期令牌，后续每一步都必须携带，防止绕过密码校验直接换绑。
 * 令牌与阶段状态只存在 Redis，验证码由 EmailCodeService 原子校验并消费。
 */
@Injectable()
export class EmailChangeService {
  private readonly logger = new Logger(EmailChangeService.name)
  private readonly pepper = loadEmailCodeConfig().pepper

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly emailCodeService: EmailCodeService,
    private readonly authService: AuthService,
  ) {}

  /** 第一步：验证当前密码，换取短期换绑令牌 */
  async verifyPassword(
    userId: string,
    password: string,
  ): Promise<{ changeToken: string; expiresIn: number }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { status: true, passwordHash: true },
    })

    if (!user) {
      throw new UnauthorizedException({ code: 40101, data: null, message: '登录状态已失效' })
    }

    if (user.status !== 'ACTIVE') {
      throw new ForbiddenException({ code: 40300, data: null, message: '账号已被禁用或锁定' })
    }

    const valid = await argon2.verify(user.passwordHash, password)

    if (!valid) {
      throw new UnauthorizedException({ code: 40100, data: null, message: '当前密码不正确' })
    }

    const changeToken = randomBytes(32).toString('hex')
    const key = this.buildKey(userId)

    await this.runRedis(async (client) => {
      await client.hSet(key, {
        tokenDigest: hashEmailChangeToken(this.pepper, changeToken),
        stage: STAGE_PENDING_UNBIND,
      })
      await client.expire(key, EMAIL_CHANGE_TTL_SECONDS)
    })

    return { changeToken, expiresIn: EMAIL_CHANGE_TTL_SECONDS }
  }

  /** 第二步：解绑原邮箱（幂等） */
  async unbind(userId: string, changeToken: string): Promise<{ email: null }> {
    const key = this.buildKey(userId)
    const stage = await this.assertToken(key, changeToken)

    if (stage !== STAGE_PENDING_UNBIND) {
      throw this.badStage('请先重新验证当前密码')
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { email: null, emailVerifiedAt: null },
    })

    await this.runRedis(async (client) => {
      await client.hSet(key, 'stage', STAGE_UNBOUND)
      await client.expire(key, EMAIL_CHANGE_TTL_SECONDS)
    })

    return { email: null }
  }

  /** 第三步：向新邮箱发送验证码 */
  async requestBindCode(
    userId: string,
    changeToken: string,
    email: string,
    ip: string | null,
  ): Promise<{ expiresIn: number; resendAfter: number }> {
    const stage = await this.assertToken(this.buildKey(userId), changeToken)

    if (stage !== STAGE_UNBOUND) {
      throw this.badStage('请先解绑原邮箱')
    }

    return this.emailCodeService.requestBindEmailCode({ email, ip })
  }

  /** 第四步：校验新邮箱验证码并绑定 */
  async bind(userId: string, changeToken: string, email: string, code: string): Promise<AuthUser> {
    const key = this.buildKey(userId)
    const stage = await this.assertToken(key, changeToken)

    if (stage !== STAGE_UNBOUND) {
      throw this.badStage('请先解绑原邮箱')
    }

    const normalizedEmail = email.trim().toLowerCase()

    await this.emailCodeService.verifyAndConsumeBindEmailCode({ email: normalizedEmail, code })

    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: { email: normalizedEmail, emailVerifiedAt: new Date() },
      })
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException({ code: 40900, data: null, message: '该邮箱已被其他账号使用' })
      }

      throw error
    }

    await this.runRedis((client) => client.del(key))

    return this.authService.getMe({ userId, sessionId: '' })
  }

  private buildKey(userId: string): string {
    return `${KEY_PREFIX}:${hashIdentifier(this.pepper, 'user', userId)}`
  }

  /** 校验令牌并返回当前阶段 */
  private async assertToken(key: string, changeToken: string): Promise<string> {
    const record = await this.runRedis((client) => client.hGetAll(key))

    if (!record || Object.keys(record).length === 0) {
      throw new BadRequestException({
        code: EMAIL_CHANGE_ERROR_CODE.INVALID_STAGE,
        data: null,
        message: '身份验证已过期，请重新验证当前密码',
      })
    }

    if (
      !record['tokenDigest'] ||
      !safeEqual(record['tokenDigest'], hashEmailChangeToken(this.pepper, changeToken))
    ) {
      throw new BadRequestException({
        code: EMAIL_CHANGE_ERROR_CODE.INVALID_TOKEN,
        data: null,
        message: '身份验证令牌无效，请重新验证当前密码',
      })
    }

    return record['stage'] ?? ''
  }

  private badStage(message: string): BadRequestException {
    return new BadRequestException({
      code: EMAIL_CHANGE_ERROR_CODE.INVALID_STAGE,
      data: null,
      message,
    })
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002'
    )
  }

  private async runRedis<T>(
    operation: (client: ReturnType<RedisService['getClient']>) => Promise<T>,
  ): Promise<T> {
    const client = this.redis.getClient()

    try {
      return await operation(client)
    } catch (error) {
      if (error instanceof HttpException) throw error

      this.logger.error(`Redis 操作失败：${error instanceof Error ? error.message : String(error)}`)

      throw createRedisUnavailableError()
    }
  }
}
