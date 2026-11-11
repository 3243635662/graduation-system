import { API_PREFIX } from '@graduation/shared'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { createClient, type RedisClientType } from 'redis'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { configureGlobalEnhancers } from '../src/common/configure-global-enhancers.js'
import { RateLimitGuard } from '../src/common/rate-limit/rate-limit.guard.js'
import { loadRedisConfig } from '../src/common/redis/redis.config.js'
import { REDIS_CLIENT } from '../src/common/redis/redis.constants.js'
import type { RedisClient } from '../src/common/redis/redis.provider.js'
import { RedisService } from '../src/common/redis/redis.service.js'
import { AuthController } from '../src/modules/auth/auth.controller.js'
import { AuthService } from '../src/modules/auth/auth.service.js'
import { hashIdentifier } from '../src/modules/auth/email-code/email-code.crypto.js'
import { buildEmailCodeKeys } from '../src/modules/auth/email-code/email-code.keys.js'
import { EmailCodeService } from '../src/modules/auth/email-code/email-code.service.js'
import { EmailService } from '../src/modules/auth/email/email.service.js'
import { AccessTokenGuard } from '../src/modules/auth/guards/access-token.guard.js'
import { OriginGuard } from '../src/modules/auth/guards/origin.guard.js'
import { TokenService } from '../src/modules/auth/services/token.service.js'
import { PrismaService } from '../src/prisma/prisma.service.js'
import { CapturingEmailService } from './fixtures/capturing-email-service.js'
import { createInMemoryPrisma } from './fixtures/in-memory-prisma.js'
import { setupEmailCodeTestEnv, TEST_PEPPER } from './fixtures/test-env.js'

const apiUrl = `/${API_PREFIX}/auth`

/** Redis 不可用的假客户端：isReady=false 时 RedisService 必须失败关闭 */
const unavailableRedisClient = {
  isReady: false,
  isOpen: false,
} as unknown as RedisClient

async function createApp(options: {
  redisClient: RedisClient
  prisma: unknown
  email: CapturingEmailService
}): Promise<INestApplication<App>> {
  const moduleFixture = await Test.createTestingModule({
    controllers: [AuthController],
    providers: [
      AuthService,
      TokenService,
      AccessTokenGuard,
      OriginGuard,
      RateLimitGuard,
      EmailCodeService,
      RedisService,
      { provide: PrismaService, useValue: options.prisma },
      { provide: EmailService, useValue: options.email },
      { provide: REDIS_CLIENT, useValue: options.redisClient },
    ],
  })
    .overrideGuard(RateLimitGuard)
    .useValue({ canActivate: () => true })
    .compile()

  const app = moduleFixture.createNestApplication()
  app.setGlobalPrefix(API_PREFIX)
  configureGlobalEnhancers(app)

  await app.init()

  return app
}

describe('邮箱验证码注册 (e2e)', () => {
  let app: INestApplication<App>
  let brokenApp: INestApplication<App>
  let redisClient: RedisClientType
  let keyPrefix: string
  let emailFake: CapturingEmailService
  let prismaFake: ReturnType<typeof createInMemoryPrisma>

  const keysOf = () => buildEmailCodeKeys(keyPrefix)
  const codeKeyOf = (email: string) => keysOf().code(hashIdentifier(TEST_PEPPER, 'email', email))

  beforeAll(async () => {
    process.env['JWT_ACCESS_SECRET'] = 'e2e-register-secret'
    process.env['ACCESS_TOKEN_TTL_SECONDS'] = '900'
    process.env['REFRESH_TOKEN_TTL_DAYS'] = '7'
    process.env['CORS_ORIGIN'] = 'http://localhost:5173'

    keyPrefix = setupEmailCodeTestEnv('register-e2e')

    const config = loadRedisConfig()
    redisClient = createClient({
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
    redisClient.on('error', () => undefined)

    try {
      await redisClient.connect()
    } catch (error) {
      throw new Error(
        `注册 E2E 需要可用的 Redis（${config.host}:${config.port}）：${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      )
    }

    prismaFake = createInMemoryPrisma()
    emailFake = new CapturingEmailService()

    app = await createApp({
      redisClient: redisClient as unknown as RedisClient,
      prisma: prismaFake.prisma,
      email: emailFake,
    })

    brokenApp = await createApp({
      redisClient: unavailableRedisClient,
      prisma: createInMemoryPrisma().prisma,
      email: new CapturingEmailService(),
    })
  })

  afterAll(async () => {
    if (redisClient?.isOpen) {
      const ownKeys = await redisClient.keys(`${keyPrefix}:*`)

      if (ownKeys.length > 0) {
        await redisClient.del(ownKeys)
      }
    }

    await brokenApp?.close()
    await app?.close()
  })

  async function sendCode(email: string): Promise<string> {
    await request(app.getHttpServer())
      .post(`${apiUrl}/email-codes/register`)
      .send({ email })
      .expect(200)

    return emailFake.lastCodeFor(email)
  }

  it('验证码过期后注册失败（40012）', async () => {
    const email = 'expired-code@example.com'
    const emailCode = await sendCode(email)

    // 真实 TTL 到期：把剩余的 120 秒压到 1ms
    await redisClient.pExpire(codeKeyOf(email), 1)
    await new Promise((resolve) => setTimeout(resolve, 30))

    await request(app.getHttpServer())
      .post(`${apiUrl}/register`)
      .send({
        displayName: '过期验证码',
        email,
        emailCode,
        password: 'password123',
        confirmPassword: 'password123',
      })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe(40012)
      })
  })

  it('错误次数达到 5 次后验证码作废（40013）', async () => {
    const email = 'attempts-code@example.com'
    const emailCode = await sendCode(email)
    const wrongCode = emailCode === '123456' ? '654321' : '123456'

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await request(app.getHttpServer())
        .post(`${apiUrl}/register`)
        .send({
          displayName: '错误次数',
          email,
          emailCode: wrongCode,
          password: 'password123',
          confirmPassword: 'password123',
        })
        .expect(400)

      expect([40011, 40013]).toContain(response.body.code)

      if (attempt === 5) {
        expect(response.body.code).toBe(40013)
      }
    }

    // 作废后即使输入正确验证码也无法注册
    await request(app.getHttpServer())
      .post(`${apiUrl}/register`)
      .send({
        displayName: '错误次数',
        email,
        emailCode,
        password: 'password123',
        confirmPassword: 'password123',
      })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe(40012)
      })
  })

  it('注册成功只返回 Access Token，Refresh Token 仅进 HttpOnly Cookie', async () => {
    const email = 'cookie-contract@example.com'
    const emailCode = await sendCode(email)

    const response = await request(app.getHttpServer())
      .post(`${apiUrl}/register`)
      .send({
        displayName: 'Cookie 契约',
        email,
        emailCode,
        password: 'password123',
        confirmPassword: 'password123',
      })
      .expect(201)

    // 响应体不得包含 Refresh Token 与密码哈希
    expect(Object.keys(response.body.data).sort()).toEqual(['accessToken', 'user'])
    expect(JSON.stringify(response.body)).not.toContain('refreshToken')
    expect(JSON.stringify(response.body)).not.toContain('passwordHash')

    const setCookie = response.headers['set-cookie']
    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie ?? '']
    const refreshCookie = cookies.find((item) => item.startsWith('refresh_token='))

    expect(refreshCookie).toBeTruthy()
    expect(refreshCookie).toMatch(/HttpOnly/i)
    expect(refreshCookie).toMatch(/Path=\/api\/auth/i)
  })

  it('注册用户默认获得 STUDENT 角色并可直接访问 /me', async () => {
    const email = 'student-role@example.com'
    const emailCode = await sendCode(email)

    const response = await request(app.getHttpServer())
      .post(`${apiUrl}/register`)
      .send({
        displayName: '学生角色',
        email,
        emailCode,
        password: 'password123',
        confirmPassword: 'password123',
        // 客户端尝试作弊指定角色，必须被忽略
        role: 'ADMIN',
        roleId: 'role-admin',
      })
      .expect(201)

    expect(response.body.data.user.roles).toEqual([
      { id: 'role-student', code: 'STUDENT', name: '学生' },
    ])

    await request(app.getHttpServer())
      .get(`${apiUrl}/me`)
      .set('Authorization', `Bearer ${response.body.data.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.data.email).toBe(email)
      })
  })

  it('Redis 不可用时发送验证码返回 503', async () => {
    await request(brokenApp.getHttpServer())
      .post(`${apiUrl}/email-codes/register`)
      .send({ email: 'redis-down-send@example.com' })
      .expect(503)
      .expect(({ body }) => {
        expect(body.code).toBe(50300)
      })
  })

  it('Redis 不可用时注册接口不能跳过验证（返回 503）', async () => {
    await request(brokenApp.getHttpServer())
      .post(`${apiUrl}/register`)
      .send({
        displayName: '无 Redis',
        email: 'redis-down-register@example.com',
        emailCode: '123456',
        password: 'password123',
        confirmPassword: 'password123',
      })
      .expect(503)
      .expect(({ body }) => {
        expect(body.code).toBe(50300)
      })
  })
})
