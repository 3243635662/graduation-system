import type { SendEmailCodeResult } from '@graduation/shared'
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common'

import type { RedisClient } from '../../../common/redis/redis.provider.js'
import { createRedisUnavailableError, RedisService } from '../../../common/redis/redis.service.js'
import { PrismaService } from '../../../prisma/prisma.service.js'
import { EmailService } from '../email/email.service.js'
import { loadEmailCodeConfig, type EmailCodeConfig } from './email-code.config.js'
import {
  generateSixDigitCode,
  hashIdentifier,
  hashRegisterCode,
  normalizeEmail,
} from './email-code.crypto.js'
import { buildEmailCodeKeys, type EmailCodeKeys } from './email-code.keys.js'
import {
  INCR_WITH_TTL_SCRIPT,
  SET_CODE_SCRIPT,
  VERIFY_AND_CONSUME_SCRIPT,
} from './email-code.scripts.js'

/** 验证码相关业务错误码 */
export const EMAIL_CODE_ERROR_CODE = {
  /** 验证码错误 */
  INVALID: 40011,
  /** 验证码已过期或不存在 */
  EXPIRED: 40012,
  /** 错误次数过多，验证码已作废 */
  EXHAUSTED: 40013,
  /** 邮件/验证码服务不可用 */
  UNAVAILABLE: 50300,
} as const

const HOUR_SECONDS = 3_600
/** 发送失败后的冷却上限（秒），避免 SMTP 故障期间被持续重试 */
const MAX_FAILURE_COOLDOWN_SECONDS = 300

export interface RequestRegisterCodeOptions {
  /** 已经过 Zod 校验的邮箱 */
  email: string
  /** 可信客户端 IP；为空表示无法识别，此时跳过 IP 维度限流 */
  ip: string | null
}

export interface VerifyRegisterCodeOptions {
  email: string
  code: string
}

/**
 * 邮箱验证码服务
 *
 * 职责：
 * - 生成六位验证码并以 HMAC 摘要形式存入 Redis（不存明文）
 * - 冷却、单邮箱每小时、单 IP 每小时三重限流
 * - 用 Lua 脚本原子校验并消费验证码（一次性、防并发）
 *
 * 所有 Redis 故障都转换为 503：绝不降级为内存存储，也绝不放行未验证的注册。
 */
@Injectable()
export class EmailCodeService {
  private readonly logger = new Logger(EmailCodeService.name)
  private readonly config: EmailCodeConfig
  private readonly keys: EmailCodeKeys

  constructor(
    private readonly redis: RedisService,
    private readonly emailService: EmailService,
    private readonly prisma: PrismaService,
  ) {
    this.config = loadEmailCodeConfig()
    this.keys = buildEmailCodeKeys(this.config.keyPrefix)
  }

  /** 验证码有效期（秒），用于响应体 */
  get codeTtlSeconds(): number {
    return this.config.codeTtlSeconds
  }

  /** 重新发送冷却（秒），用于响应体 */
  get resendIntervalSeconds(): number {
    return this.config.resendIntervalSeconds
  }

  /**
   * 发送注册验证码
   *
   * 顺序：冷却 → 单邮箱小时限额 → 单 IP 小时限额 → 抢占冷却 → 邮箱是否已注册 → 生成并发送。
   * 邮箱已注册时静默返回相同结构，避免账号枚举。
   */
  async requestRegisterCode(options: RequestRegisterCodeOptions): Promise<SendEmailCodeResult> {
    const email = normalizeEmail(options.email)
    const emailHash = hashIdentifier(this.config.pepper, 'email', email)

    // 1. 发送冷却（先读，避免无意义地消耗小时配额）
    const cooldownTtl = await this.runRedis((client) => client.ttl(this.keys.cooldown(emailHash)))

    if (cooldownTtl > 0) {
      throw this.tooManyRequests(cooldownTtl)
    }

    // 2. 单邮箱每小时上限
    const emailSends = await this.incrementHourly(this.keys.hourly(emailHash))

    if (emailSends > this.config.maxSendsPerEmailPerHour) {
      throw this.tooManyRequests()
    }

    // 3. 单 IP 每小时上限：拿不到可信 IP 时跳过，不把所有人当成同一个 IP
    if (options.ip) {
      const ipHash = hashIdentifier(this.config.pepper, 'ip', options.ip)
      const ipSends = await this.incrementHourly(this.keys.ipHourly(ipHash))

      if (ipSends > this.config.maxSendsPerIpHour) {
        throw this.tooManyRequests()
      }
    }

    // 4. 原子抢占冷却：并发请求只有一个能真正发信
    const claimed = await this.runRedis((client) =>
      client.set(this.keys.cooldown(emailHash), '1', {
        NX: true,
        EX: this.config.resendIntervalSeconds,
      }),
    )

    if (claimed === null) {
      const retryAfter = await this.runRedis((client) => client.ttl(this.keys.cooldown(emailHash)))

      throw this.tooManyRequests(retryAfter)
    }

    // 5. 邮箱已注册：不发送、不暴露，返回与成功完全一致的结构
    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    })

    if (existing) return this.buildResult()

    // 6. 生成验证码并保存摘要（Hash：digest / attempts，Key 自带 TTL）
    const code = generateSixDigitCode()

    await this.runRedis((client) =>
      client.eval(SET_CODE_SCRIPT, {
        keys: [this.keys.code(emailHash)],
        arguments: [
          hashRegisterCode(this.config.pepper, email, code),
          String(this.config.codeTtlSeconds),
        ],
      }),
    )

    // 7. 发信失败：删除验证码，保留失败冷却，返回统一服务错误
    try {
      await this.emailService.sendRegisterCode({
        to: email,
        code,
        expiresInSeconds: this.config.codeTtlSeconds,
      })
    } catch (error) {
      await this.discardCode(emailHash)
      await this.keepFailureCooldown(emailHash)

      if (error instanceof HttpException) throw error

      throw new ServiceUnavailableException({
        code: EMAIL_CODE_ERROR_CODE.UNAVAILABLE,
        data: null,
        message: '邮件发送失败，请稍后重试',
      })
    }

    return this.buildResult()
  }

  /**
   * 原子校验并消费注册验证码
   *
   * 校验与删除在同一次 Redis 调用内完成：同一个验证码只能成功一次。
   */
  async verifyAndConsumeRegisterCode(options: VerifyRegisterCodeOptions): Promise<void> {
    const email = normalizeEmail(options.email)
    const emailHash = hashIdentifier(this.config.pepper, 'email', email)
    const digest = hashRegisterCode(this.config.pepper, email, options.code)

    const result = await this.runRedis((client) =>
      client.eval(VERIFY_AND_CONSUME_SCRIPT, {
        keys: [this.keys.code(emailHash)],
        arguments: [digest, String(this.config.maxAttempts)],
      }),
    )

    switch (String(result)) {
      case 'SUCCESS':
        return

      case 'EXPIRED':
        throw this.badRequest('验证码已过期，请重新获取', EMAIL_CODE_ERROR_CODE.EXPIRED)

      case 'EXHAUSTED':
        throw this.badRequest('验证码错误次数过多，请重新获取', EMAIL_CODE_ERROR_CODE.EXHAUSTED)

      default:
        throw this.badRequest('邮箱验证码不正确', EMAIL_CODE_ERROR_CODE.INVALID)
    }
  }

  private buildResult(): SendEmailCodeResult {
    return {
      expiresIn: this.config.codeTtlSeconds,
      resendAfter: this.config.resendIntervalSeconds,
    }
  }

  private async incrementHourly(key: string): Promise<number> {
    const count = await this.runRedis((client) =>
      client.eval(INCR_WITH_TTL_SCRIPT, {
        keys: [key],
        arguments: [String(HOUR_SECONDS)],
      }),
    )

    return Number(count)
  }

  /** 统一包裹 Redis 调用：任何底层错误都按服务不可用处理 */
  private async runRedis<T>(operation: (client: RedisClient) => Promise<T>): Promise<T> {
    const client = this.redis.getClient()

    try {
      return await operation(client)
    } catch (error) {
      if (error instanceof HttpException) throw error

      this.logger.error(`Redis 操作失败：${error instanceof Error ? error.message : String(error)}`)

      throw createRedisUnavailableError()
    }
  }

  private async discardCode(emailHash: string): Promise<void> {
    await this.runRedis((client) => client.del(this.keys.code(emailHash))).catch(() => undefined)
  }

  private async keepFailureCooldown(emailHash: string): Promise<void> {
    const seconds = Math.min(this.config.resendIntervalSeconds * 2, MAX_FAILURE_COOLDOWN_SECONDS)

    await this.runRedis((client) =>
      client.set(this.keys.cooldown(emailHash), '1', { EX: seconds }),
    ).catch(() => undefined)
  }

  private tooManyRequests(retryAfterSeconds?: number): HttpException {
    return new HttpException(
      {
        code: 42900,
        data: {
          retryAfter:
            typeof retryAfterSeconds === 'number' && retryAfterSeconds > 0
              ? retryAfterSeconds
              : this.config.resendIntervalSeconds,
        },
        message: '验证码发送过于频繁，请稍后再试',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    )
  }

  private badRequest(message: string, code: number): BadRequestException {
    return new BadRequestException({ code, data: null, message })
  }
}
