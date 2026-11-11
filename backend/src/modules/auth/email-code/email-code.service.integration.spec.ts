import { HttpException, ServiceUnavailableException } from '@nestjs/common'
import { createClient, type RedisClientType } from 'redis'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { setupEmailCodeTestEnv, TEST_PEPPER } from '../../../../test/fixtures/test-env.js'
import { loadRedisConfig } from '../../../common/redis/redis.config.js'
import type { RedisClient } from '../../../common/redis/redis.provider.js'
import { RedisService } from '../../../common/redis/redis.service.js'
import type { PrismaService } from '../../../prisma/prisma.service.js'
import type { EmailService } from '../email/email.service.js'
import { hashIdentifier, hashRegisterCode } from './email-code.crypto.js'
import { buildEmailCodeKeys, type EmailCodeKeys } from './email-code.keys.js'
import { EmailCodeService } from './email-code.service.js'

/**
 * 真实 Redis 集成测试
 *
 * Lua 原子性、TTL、并发消费只能在真实 Redis 上验证，不能用 Mock 代替。
 * 所有 Key 都带本次运行独有的前缀，测试只清理自己写入的数据（不执行 FLUSHDB）。
 */

interface CapturedMail {
  to: string
  code: string
  expiresInSeconds: number
}

class CapturingEmailService {
  readonly sent: CapturedMail[] = []
  private failure: Error | null = null

  failNextWith(error: Error): void {
    this.failure = error
  }

  async sendRegisterCode(options: CapturedMail): Promise<void> {
    if (this.failure) {
      const failure = this.failure
      this.failure = null

      throw failure
    }

    this.sent.push(options)
  }

  get lastCode(): string {
    const last = this.sent.at(-1)

    if (!last) throw new Error('没有捕获到验证码邮件')

    return last.code
  }
}

const REGISTERED_EMAILS = new Set<string>()

const prismaFake = {
  user: {
    async findUnique({ where }: { where: { email?: string } }) {
      return where.email && REGISTERED_EMAILS.has(where.email) ? { id: 'user-existing' } : null
    },
  },
} as unknown as PrismaService

function expectHttpError(error: unknown, status: number) {
  expect(error).toBeInstanceOf(HttpException)
  expect((error as HttpException).getStatus()).toBe(status)

  return (error as HttpException).getResponse() as {
    code: number
    message: string
    data?: { retryAfter?: number } | null
  }
}

describe('EmailCodeService（真实 Redis 集成）', () => {
  let client: RedisClientType
  let redisService: RedisService
  let emailService: CapturingEmailService
  let service: EmailCodeService
  let keys: EmailCodeKeys
  let prefix: string

  const emailHash = (email: string) => hashIdentifier(TEST_PEPPER, 'email', email)
  const codeKeyOf = (email: string) => keys.code(hashIdentifier(TEST_PEPPER, 'email', email))
  const cooldownKeyOf = (email: string) =>
    keys.cooldown(hashIdentifier(TEST_PEPPER, 'email', email))

  let sequence = 0
  function uniqueEmail(tag: string): string {
    sequence += 1

    return `${tag}-${sequence}@test.example.com`
  }

  function createService(overrides: Record<string, string> = {}): EmailCodeService {
    setupEmailCodeTestEnv('integration', { keyPrefix: prefix, overrides })
    keys = buildEmailCodeKeys(prefix)

    return new EmailCodeService(redisService, emailService as unknown as EmailService, prismaFake)
  }

  beforeAll(async () => {
    prefix = setupEmailCodeTestEnv('integration')

    const config = loadRedisConfig()
    client = createClient({
      socket: {
        host: config.host,
        port: config.port,
        connectTimeout: 3_000,
        reconnectStrategy: () => false,
      },
      username: config.username,
      password: config.password,
      database: config.database,
      disableOfflineQueue: true,
    })

    // 避免连接错误事件导致未捕获异常
    client.on('error', () => undefined)

    try {
      await client.connect()
    } catch (error) {
      throw new Error(
        `集成测试需要可用的 Redis（${config.host}:${config.port}）：${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      )
    }

    redisService = new RedisService(client as unknown as RedisClient)
    emailService = new CapturingEmailService()
    service = createService()
  })

  afterAll(async () => {
    if (!client?.isOpen) return

    // 只删除本次运行创建的 Key，绝不 FLUSHDB
    const ownKeys = await client.keys(`${prefix}:*`)

    if (ownKeys.length > 0) {
      await client.del(ownKeys)
    }

    await client.quit()
  })

  beforeEach(() => {
    emailService.sent.length = 0
    REGISTERED_EMAILS.clear()
    service = createService()
  })

  describe('发送验证码', () => {
    it('返回有效期与冷却时间，并写入摘要而非明文', async () => {
      const email = uniqueEmail('send')

      const result = await service.requestRegisterCode({ email, ip: '203.0.113.1' })

      expect(result).toEqual({ expiresIn: 120, resendAfter: 60 })
      expect(emailService.sent).toHaveLength(1)
      expect(emailService.sent[0]?.to).toBe(email)

      const record = await client.hGetAll(codeKeyOf(email))
      const code = emailService.lastCode

      expect(record['digest']).toBe(hashRegisterCode(TEST_PEPPER, email, code))
      expect(record['attempts']).toBe('0')
      // 明文验证码绝不能出现在 Redis 中
      expect(JSON.stringify(record)).not.toContain(code)
    })

    it('验证码 TTL 为 120 秒，冷却 TTL 为 60 秒', async () => {
      const email = uniqueEmail('ttl')

      await service.requestRegisterCode({ email, ip: '203.0.113.2' })

      const codeTtl = await client.ttl(codeKeyOf(email))
      const cooldownTtl = await client.ttl(cooldownKeyOf(email))

      expect(codeTtl).toBeGreaterThan(0)
      expect(codeTtl).toBeLessThanOrEqual(120)
      expect(cooldownTtl).toBeGreaterThan(0)
      expect(cooldownTtl).toBeLessThanOrEqual(60)
    })

    it('60 秒冷却内重复发送返回 429，并给出剩余秒数', async () => {
      const email = uniqueEmail('cooldown')

      await service.requestRegisterCode({ email, ip: '203.0.113.3' })

      const error = await service
        .requestRegisterCode({ email, ip: '203.0.113.3' })
        .catch((caught: unknown) => caught)

      const body = expectHttpError(error, 429)

      expect(body.code).toBe(42900)
      expect(body.data?.retryAfter).toBeGreaterThan(0)
      expect(emailService.sent).toHaveLength(1)
    })

    it('单邮箱每小时发送次数受限', async () => {
      const scoped = createService({ EMAIL_CODE_MAX_SENDS_PER_HOUR: '2' })
      const email = uniqueEmail('hourly')

      await scoped.requestRegisterCode({ email, ip: '203.0.113.4' })
      await client.del(cooldownKeyOf(email))
      await scoped.requestRegisterCode({ email, ip: '203.0.113.4' })
      await client.del(cooldownKeyOf(email))

      const error = await scoped
        .requestRegisterCode({ email, ip: '203.0.113.4' })
        .catch((caught: unknown) => caught)

      const body = expectHttpError(error, 429)

      expect(body.code).toBe(42900)
      expect(emailService.sent).toHaveLength(2)

      const counterTtl = await client.ttl(keys.hourly(emailHash(email)))
      expect(counterTtl).toBeGreaterThan(0)
      expect(counterTtl).toBeLessThanOrEqual(3_600)
    })

    it('单 IP 每小时发送次数受限', async () => {
      const scoped = createService({
        EMAIL_CODE_MAX_SENDS_PER_IP_HOUR: '2',
        EMAIL_CODE_MAX_SENDS_PER_HOUR: '10',
      })

      const firstEmail = uniqueEmail('ip-a')
      const secondEmail = uniqueEmail('ip-b')
      const thirdEmail = uniqueEmail('ip-c')

      await scoped.requestRegisterCode({ email: firstEmail, ip: '198.51.100.7' })
      await scoped.requestRegisterCode({ email: secondEmail, ip: '198.51.100.7' })

      const error = await scoped
        .requestRegisterCode({ email: thirdEmail, ip: '198.51.100.7' })
        .catch((caught: unknown) => caught)

      expectHttpError(error, 429)

      // 另一个 IP 不受影响
      await expect(
        scoped.requestRegisterCode({ email: uniqueEmail('ip-d'), ip: '198.51.100.8' }),
      ).resolves.toMatchObject({ expiresIn: 120 })
    })

    it('邮箱已注册时静默返回，不发信也不写验证码', async () => {
      const email = uniqueEmail('existing')
      REGISTERED_EMAILS.add(email)

      const result = await service.requestRegisterCode({ email, ip: '203.0.113.5' })

      expect(result).toEqual({ expiresIn: 120, resendAfter: 60 })
      expect(emailService.sent).toHaveLength(0)
      expect(await client.exists(codeKeyOf(email))).toBe(0)
    })

    it('邮件发送失败时删除验证码、保留失败冷却并返回 503', async () => {
      const email = uniqueEmail('smtp-fail')
      emailService.failNextWith(new Error('SMTP connection timeout'))

      const error = await service
        .requestRegisterCode({ email, ip: '203.0.113.6' })
        .catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(ServiceUnavailableException)
      expect(expectHttpError(error, 503).code).toBe(50300)
      // 验证码必须作废，避免用户收到无法验证的邮件
      expect(await client.exists(codeKeyOf(email))).toBe(0)
      expect(await client.ttl(cooldownKeyOf(email))).toBeGreaterThan(0)
    })

    it('无法识别 IP 时跳过 IP 维度限流但仍受邮箱维度限制', async () => {
      const email = uniqueEmail('no-ip')

      const result = await service.requestRegisterCode({ email, ip: null })

      expect(result.resendAfter).toBe(60)

      const error = await service
        .requestRegisterCode({ email, ip: null })
        .catch((caught: unknown) => caught)

      expectHttpError(error, 429)
    })
  })

  describe('校验并消费验证码', () => {
    it('正确验证码验证成功后立即失效（一次性）', async () => {
      const email = uniqueEmail('consume')

      await service.requestRegisterCode({ email, ip: '203.0.113.10' })
      const code = emailService.lastCode

      await expect(service.verifyAndConsumeRegisterCode({ email, code })).resolves.toBeUndefined()

      const secondError = await service
        .verifyAndConsumeRegisterCode({ email, code })
        .catch((caught: unknown) => caught)

      expect(expectHttpError(secondError, 400).code).toBe(40012)
    })

    it('验证码过期后无法通过', async () => {
      const email = uniqueEmail('expired')

      await service.requestRegisterCode({ email, ip: '203.0.113.11' })
      const code = emailService.lastCode

      // 把 TTL 压到 1ms，等待自然过期（真实过期，而不是删 Key）
      await client.pExpire(codeKeyOf(email), 1)
      await new Promise((resolve) => setTimeout(resolve, 30))

      const error = await service
        .verifyAndConsumeRegisterCode({ email, code })
        .catch((caught: unknown) => caught)

      expect(expectHttpError(error, 400).code).toBe(40012)
    })

    it('错误验证码计数，达到 5 次后作废', async () => {
      const email = uniqueEmail('attempts')

      await service.requestRegisterCode({ email, ip: '203.0.113.12' })

      for (let attempt = 1; attempt <= 4; attempt += 1) {
        const error = await service
          .verifyAndConsumeRegisterCode({ email, code: '000000' })
          .catch((caught: unknown) => caught)

        expect(expectHttpError(error, 400).code).toBe(40011)
        expect(await client.hGet(codeKeyOf(email), 'attempts')).toBe(String(attempt))
      }

      const exhausted = await service
        .verifyAndConsumeRegisterCode({ email, code: '000000' })
        .catch((caught: unknown) => caught)

      expect(expectHttpError(exhausted, 400).code).toBe(40013)
      // 达到上限后 Key 被删除，连正确的验证码也不能再用
      expect(await client.exists(codeKeyOf(email))).toBe(0)

      const afterError = await service
        .verifyAndConsumeRegisterCode({ email, code: emailService.lastCode })
        .catch((caught: unknown) => caught)

      expect(expectHttpError(afterError, 400).code).toBe(40012)
    })

    it('并发消费同一验证码只有一个请求成功', async () => {
      const email = uniqueEmail('concurrent')

      await service.requestRegisterCode({ email, ip: '203.0.113.13' })
      const code = emailService.lastCode

      const results = await Promise.allSettled(
        Array.from({ length: 6 }, () => service.verifyAndConsumeRegisterCode({ email, code })),
      )

      const succeeded = results.filter((item) => item.status === 'fulfilled')
      const failed = results.filter((item) => item.status === 'rejected')

      expect(succeeded).toHaveLength(1)
      expect(failed).toHaveLength(5)

      for (const item of failed) {
        expect((item as PromiseRejectedResult).reason).toBeInstanceOf(HttpException)
      }
    })

    it('其他邮箱无法使用别人的验证码', async () => {
      const owner = uniqueEmail('owner')
      const attacker = uniqueEmail('attacker')

      await service.requestRegisterCode({ email: owner, ip: '203.0.113.14' })
      const code = emailService.lastCode

      const error = await service
        .verifyAndConsumeRegisterCode({ email: attacker, code })
        .catch((caught: unknown) => caught)

      expect(expectHttpError(error, 400).code).toBe(40012)
    })

    it('未发送验证码时校验直接失败', async () => {
      const email = uniqueEmail('never-sent')

      const error = await service
        .verifyAndConsumeRegisterCode({ email, code: '123456' })
        .catch((caught: unknown) => caught)

      expect(expectHttpError(error, 400).code).toBe(40012)
    })
  })

  describe('Redis 不可用时失败关闭', () => {
    it('密码错误时无法建立连接，且业务侧按不可用处理', async () => {
      const config = loadRedisConfig()
      const wrongPasswordClient = createClient({
        socket: {
          host: config.host,
          port: config.port,
          connectTimeout: 2_000,
          reconnectStrategy: () => false,
        },
        username: config.username,
        password: `${config.password ?? 'x'}-wrong`,
        database: config.database,
        disableOfflineQueue: true,
      })

      wrongPasswordClient.on('error', () => undefined)

      await expect(wrongPasswordClient.connect()).rejects.toBeTruthy()
      await wrongPasswordClient.destroy()

      const brokenService = new EmailCodeService(
        new RedisService(wrongPasswordClient as unknown as RedisClient),
        emailService as unknown as EmailService,
        prismaFake,
      )

      const error = await brokenService
        .verifyAndConsumeRegisterCode({ email: 'wrong-password@test.example.com', code: '123456' })
        .catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(ServiceUnavailableException)
      expect(expectHttpError(error, 503).code).toBe(50300)
    })

    it('Redis 地址不可达时连接失败', async () => {
      const unreachableClient = createClient({
        socket: {
          host: '127.0.0.1',
          // 未监听的端口，模拟 Redis 宕机
          port: 6399,
          connectTimeout: 1_000,
          reconnectStrategy: () => false,
        },
        disableOfflineQueue: true,
      })

      unreachableClient.on('error', () => undefined)

      await expect(unreachableClient.connect()).rejects.toBeTruthy()
      await unreachableClient.destroy()
    })

    it('发送验证码返回 503，不会降级到内存实现', async () => {
      const unavailable = new RedisService({
        isReady: false,
      } as unknown as RedisClient)
      const brokenService = new EmailCodeService(
        unavailable,
        emailService as unknown as EmailService,
        prismaFake,
      )

      const error = await brokenService
        .requestRegisterCode({ email: uniqueEmail('redis-down'), ip: '203.0.113.15' })
        .catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(ServiceUnavailableException)
      expect(expectHttpError(error, 503).code).toBe(50300)
      expect(emailService.sent).toHaveLength(0)
    })

    it('校验验证码返回 503，不会放行注册', async () => {
      const unavailable = new RedisService({
        isReady: false,
      } as unknown as RedisClient)
      const brokenService = new EmailCodeService(
        unavailable,
        emailService as unknown as EmailService,
        prismaFake,
      )

      const error = await brokenService
        .verifyAndConsumeRegisterCode({ email: 'any@test.example.com', code: '123456' })
        .catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(ServiceUnavailableException)
      expect(expectHttpError(error, 503).code).toBe(50300)
    })
  })
})
