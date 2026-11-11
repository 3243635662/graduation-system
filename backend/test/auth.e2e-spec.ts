import { API_PREFIX } from '@graduation/shared'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import * as argon2 from 'argon2'
import { createClient, type RedisClientType } from 'redis'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'

import { configureGlobalEnhancers } from '../src/common/configure-global-enhancers.js'
import { RateLimitGuard } from '../src/common/rate-limit/rate-limit.guard.js'
import { loadRedisConfig } from '../src/common/redis/redis.config.js'
import { REDIS_CLIENT } from '../src/common/redis/redis.constants.js'
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
import { createInMemoryPrisma, STUDENT_ROLE } from './fixtures/in-memory-prisma.js'
import { setupEmailCodeTestEnv, TEST_PEPPER } from './fixtures/test-env.js'

function extractRefreshCookie(response: request.Response): string {
  const header = response.headers['set-cookie']
  const cookies = Array.isArray(header) ? header : header ? [header] : []
  const cookie = cookies.find((item) => item.startsWith('refresh_token='))

  return cookie?.split(';')[0] ?? ''
}

describe('Auth (e2e)', () => {
  let app: INestApplication<App>
  let redisClient: RedisClientType
  let keyPrefix: string
  let prismaFake: ReturnType<typeof createInMemoryPrisma>
  let emailFake: CapturingEmailService

  const apiUrl = `/${API_PREFIX}/auth`
  const student = {
    displayName: '测试学生',
    email: 'e2e-student@example.com',
    password: 'password123',
    confirmPassword: 'password123',
  }

  /** 走真实验证码接口，从假邮件服务里取回「用户邮箱里收到的验证码」 */
  async function requestRegisterCode(email: string): Promise<string> {
    await request(app.getHttpServer())
      .post(`${apiUrl}/email-codes/register`)
      .send({ email })
      .expect(200)

    return emailFake.lastCodeFor(email)
  }

  beforeAll(async () => {
    process.env['JWT_ACCESS_SECRET'] = 'e2e-test-secret'
    process.env['ACCESS_TOKEN_TTL_SECONDS'] = '900'
    process.env['REFRESH_TOKEN_TTL_DAYS'] = '7'
    process.env['REFRESH_ROTATION_GRACE_MS'] = '30000'
    process.env['CORS_ORIGIN'] = 'http://localhost:5173'

    // 独立 Key 前缀 + 固定测试 Pepper，绝不触碰开发数据
    keyPrefix = setupEmailCodeTestEnv('auth-e2e')

    const redisConfig = loadRedisConfig()
    redisClient = createClient({
      socket: {
        host: redisConfig.host,
        port: redisConfig.port,
        connectTimeout: 3_000,
        reconnectStrategy: () => false,
      },
      username: redisConfig.username,
      password: redisConfig.password,
      database: redisConfig.database,
      disableOfflineQueue: true,
    })
    redisClient.on('error', () => undefined)

    try {
      await redisClient.connect()
    } catch (error) {
      throw new Error(
        `Auth E2E 需要可用的 Redis（${redisConfig.host}:${redisConfig.port}）：${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      )
    }

    prismaFake = createInMemoryPrisma()
    emailFake = new CapturingEmailService()

    // 预置一个被禁用账号，验证禁用用户无法登录/刷新
    prismaFake.users.push({
      id: 'user-disabled',
      email: 'disabled@example.com',
      passwordHash: await argon2.hash('password123', { type: argon2.argon2id }),
      displayName: '禁用用户',
      status: 'DISABLED',
      lastLoginAt: null,
    })

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
        { provide: PrismaService, useValue: prismaFake.prisma },
        { provide: EmailService, useValue: emailFake },
        { provide: REDIS_CLIENT, useValue: redisClient },
      ],
    })
      // 限流由 rate-limit.guard.spec.ts 单独覆盖；E2E 关闭以免大量登录请求触发 429
      .overrideGuard(RateLimitGuard)
      .useValue({ canActivate: () => true })
      .compile()

    app = moduleFixture.createNestApplication()
    app.setGlobalPrefix(API_PREFIX)
    configureGlobalEnhancers(app)

    await app.init()
  })

  afterAll(async () => {
    if (redisClient?.isOpen) {
      // 只清理本次运行写入的 Key
      const ownKeys = await redisClient.keys(`${keyPrefix}:*`)

      if (ownKeys.length > 0) {
        await redisClient.del(ownKeys)
      }
    }

    // app.close() 会通过 RedisService 优雅关闭连接
    await app?.close()
  })

  describe('注册', () => {
    it('未携带邮箱验证码时无法注册', async () => {
      await request(app.getHttpServer())
        .post(`${apiUrl}/register`)
        .send({
          displayName: '缺验证码',
          email: 'no-code@example.com',
          password: 'password123',
          confirmPassword: 'password123',
        })
        .expect(400)
        .expect(({ body }) => {
          expect(body.code).toBe(40001)

          const paths = (body.data as Array<{ path: string }>).map((issue) => issue.path)

          expect(paths).toEqual(expect.arrayContaining(['emailCode']))
        })
    })

    it('未发送验证码直接注册会被拒绝', async () => {
      await request(app.getHttpServer())
        .post(`${apiUrl}/register`)
        .send({
          displayName: '未验证',
          email: 'never-requested@example.com',
          emailCode: '123456',
          password: 'password123',
          confirmPassword: 'password123',
        })
        .expect(400)
        .expect(({ body }) => {
          expect(body.code).toBe(40012)
        })
    })

    it('验证码错误时注册失败', async () => {
      const email = 'wrong-code@example.com'
      const code = await requestRegisterCode(email)
      const wrongCode = code === '111111' ? '222222' : '111111'

      await request(app.getHttpServer())
        .post(`${apiUrl}/register`)
        .send({
          displayName: '错误验证码',
          email,
          emailCode: wrongCode,
          password: 'password123',
          confirmPassword: 'password123',
        })
        .expect(400)
        .expect(({ body }) => {
          expect(body.code).toBe(40011)
        })
    })

    it('注册成功后直接建立登录态并下发 Refresh Cookie', async () => {
      const emailCode = await requestRegisterCode(student.email)

      const response = await request(app.getHttpServer())
        .post(`${apiUrl}/register`)
        .send({ ...student, emailCode })
        .expect(201)

      expect(response.body.code).toBe(0)
      expect(response.body.data.accessToken).toBeTruthy()
      expect(response.body.data.user.email).toBe(student.email)
      expect(response.body.data.user.roles).toEqual([STUDENT_ROLE])
      // 不得泄露任何密码哈希字段
      expect(response.body.data.user.passwordHash).toBeUndefined()
      expect(extractRefreshCookie(response)).toMatch(/^refresh_token=/)
    })

    it('注册成功后同一邮箱与验证码都无法再次注册', async () => {
      const email = 'reuse-code@example.com'
      const emailCode = await requestRegisterCode(email)

      await request(app.getHttpServer())
        .post(`${apiUrl}/register`)
        .send({
          displayName: '重复使用',
          email,
          emailCode,
          password: 'password123',
          confirmPassword: 'password123',
        })
        .expect(201)

      const reused = await request(app.getHttpServer())
        .post(`${apiUrl}/register`)
        .send({
          displayName: '重复使用',
          email,
          emailCode,
          password: 'password123',
          confirmPassword: 'password123',
        })
        .expect(409)

      expect(reused.body.code).toBe(40900)
    })

    it('并发使用同一个验证码只有一个请求成功', async () => {
      const email = 'race-code@example.com'
      const emailCode = await requestRegisterCode(email)

      const payload = {
        displayName: '并发注册',
        email,
        emailCode,
        password: 'password123',
        confirmPassword: 'password123',
      }

      const responses = await Promise.all([
        request(app.getHttpServer()).post(`${apiUrl}/register`).send(payload),
        request(app.getHttpServer()).post(`${apiUrl}/register`).send(payload),
        request(app.getHttpServer()).post(`${apiUrl}/register`).send(payload),
      ])

      const created = responses.filter((response) => response.status === 201)
      const rejected = responses.filter((response) => response.status !== 201)

      expect(created).toHaveLength(1)
      expect(rejected).toHaveLength(2)

      for (const response of rejected) {
        expect([400, 409]).toContain(response.status)
      }
    })

    it('重复邮箱注册返回 409', async () => {
      // 前一个用例刚给该邮箱发过验证码，先清掉冷却，单独验证「已注册也返回成功结构」
      await redisClient.del(
        buildEmailCodeKeys(keyPrefix).cooldown(hashIdentifier(TEST_PEPPER, 'email', student.email)),
      )

      // 邮箱已注册时发送验证码接口仍返回成功结构，但不会真正发信
      await request(app.getHttpServer())
        .post(`${apiUrl}/email-codes/register`)
        .send({ email: student.email })
        .expect(200)

      await request(app.getHttpServer())
        .post(`${apiUrl}/register`)
        .send({ ...student, emailCode: '123456' })
        .expect(409)
        .expect(({ body }) => {
          expect(body.code).toBe(40900)
        })
    })

    it('非法注册参数被 Zod 统一拦截', async () => {
      await request(app.getHttpServer())
        .post(`${apiUrl}/register`)
        .send({
          displayName: 'a',
          email: 'not-an-email',
          emailCode: '12ab',
          password: 'short',
          confirmPassword: 'different',
        })
        .expect(400)
        .expect(({ body }) => {
          expect(body.code).toBe(40001)

          const paths = (body.data as Array<{ path: string }>).map((issue) => issue.path)

          expect(paths).toEqual(
            expect.arrayContaining([
              'displayName',
              'email',
              'emailCode',
              'password',
              'confirmPassword',
            ]),
          )
        })
    })
  })

  describe('发送注册验证码', () => {
    it('邮箱格式非法时被 Zod 拦截', async () => {
      await request(app.getHttpServer())
        .post(`${apiUrl}/email-codes/register`)
        .send({ email: 'not-an-email' })
        .expect(400)
        .expect(({ body }) => {
          expect(body.code).toBe(40001)
        })
    })

    it('拒绝夹带角色等额外字段', async () => {
      await request(app.getHttpServer())
        .post(`${apiUrl}/email-codes/register`)
        .send({ email: 'extra-fields@example.com', role: 'ADMIN' })
        .expect(400)
        .expect(({ body }) => {
          expect(body.code).toBe(40001)
        })
    })

    it('返回统一响应，不泄露验证码本身', async () => {
      const email = 'response-shape@example.com'

      const response = await request(app.getHttpServer())
        .post(`${apiUrl}/email-codes/register`)
        .send({ email })
        .expect(200)

      expect(response.body.code).toBe(0)
      expect(response.body.message).toBe('如果该邮箱可以注册，验证码将发送至邮箱')
      expect(response.body.data).toEqual({ expiresIn: 120, resendAfter: 60 })

      const serialized = JSON.stringify(response.body)

      expect(serialized).not.toContain(emailFake.lastCodeFor(email))
    })

    it('60 秒内重复发送返回 429', async () => {
      const email = 'cooldown-e2e@example.com'

      await request(app.getHttpServer())
        .post(`${apiUrl}/email-codes/register`)
        .send({ email })
        .expect(200)

      await request(app.getHttpServer())
        .post(`${apiUrl}/email-codes/register`)
        .send({ email })
        .expect(429)
        .expect(({ body }) => {
          expect(body.code).toBe(42900)
        })
    })

    it('SMTP 发送失败时返回 503，且该验证码无法用于注册', async () => {
      const email = 'smtp-down@example.com'
      emailFake.failNextWith(new Error('SMTP connection refused'))

      await request(app.getHttpServer())
        .post(`${apiUrl}/email-codes/register`)
        .send({ email })
        .expect(503)
        .expect(({ body }) => {
          expect(body.code).toBe(50300)
          expect(body.message).toBe('邮件发送失败，请稍后重试')
        })

      await request(app.getHttpServer())
        .post(`${apiUrl}/register`)
        .send({
          displayName: '无验证码可用',
          email,
          emailCode: '123456',
          password: 'password123',
          confirmPassword: 'password123',
        })
        .expect(400)
        .expect(({ body }) => {
          expect(body.code).toBe(40012)
        })
    })
  })

  describe('登录与会话', () => {
    it('登录成功后返回用户信息与 Access Token', async () => {
      const response = await request(app.getHttpServer())
        .post(`${apiUrl}/login`)
        .send({ email: student.email, password: student.password })
        .expect(200)

      expect(response.body.code).toBe(0)
      expect(response.body.data.user.email).toBe(student.email)
      expect(response.body.data.accessToken).toBeTruthy()
    })

    it('密码错误返回统一的 401', async () => {
      await request(app.getHttpServer())
        .post(`${apiUrl}/login`)
        .send({ email: student.email, password: 'wrong-password' })
        .expect(401)
        .expect(({ body }) => {
          expect(body.code).toBe(40100)
          expect(body.message).toBe('邮箱或密码错误')
        })
    })

    it('被禁用用户无法登录', async () => {
      await request(app.getHttpServer())
        .post(`${apiUrl}/login`)
        .send({ email: 'disabled@example.com', password: 'password123' })
        .expect(403)
        .expect(({ body }) => {
          expect(body.code).toBe(40300)
        })
    })

    it('携带 Access Token 可以获取当前用户', async () => {
      const loginResponse = await request(app.getHttpServer())
        .post(`${apiUrl}/login`)
        .send({ email: student.email, password: student.password })
        .expect(200)

      const accessToken = loginResponse.body.data.accessToken as string

      await request(app.getHttpServer())
        .get(`${apiUrl}/me`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)
        .expect(({ body }) => {
          expect(body.data.email).toBe(student.email)
          expect(body.data.passwordHash).toBeUndefined()
        })
    })

    it('未携带 Access Token 访问受保护接口返回 401', async () => {
      await request(app.getHttpServer())
        .get(`${apiUrl}/me`)
        .expect(401)
        .expect(({ body }) => {
          expect(body.code).toBe(40101)
        })
    })

    it('使用 Refresh Cookie 刷新 Access Token 并轮换令牌', async () => {
      const loginResponse = await request(app.getHttpServer())
        .post(`${apiUrl}/login`)
        .send({ email: student.email, password: student.password })
        .expect(200)

      const cookie = extractRefreshCookie(loginResponse)

      const refreshResponse = await request(app.getHttpServer())
        .post(`${apiUrl}/refresh`)
        .set('Cookie', cookie)
        .expect(200)

      expect(refreshResponse.body.data.accessToken).toBeTruthy()

      const rotatedCookie = extractRefreshCookie(refreshResponse)
      expect(rotatedCookie).toMatch(/^refresh_token=/)
      expect(rotatedCookie).not.toBe(cookie)
    })

    it('两个标签页并发刷新都能成功，不会误撤销会话', async () => {
      const loginResponse = await request(app.getHttpServer())
        .post(`${apiUrl}/login`)
        .send({ email: student.email, password: student.password })
        .expect(200)

      const cookie = extractRefreshCookie(loginResponse)

      const [first, second] = await Promise.all([
        request(app.getHttpServer()).post(`${apiUrl}/refresh`).set('Cookie', cookie),
        request(app.getHttpServer()).post(`${apiUrl}/refresh`).set('Cookie', cookie),
      ])

      expect(first.status).toBe(200)
      expect(second.status).toBe(200)

      await request(app.getHttpServer())
        .get(`${apiUrl}/me`)
        .set('Authorization', `Bearer ${first.body.data.accessToken}`)
        .expect(200)

      await request(app.getHttpServer())
        .get(`${apiUrl}/me`)
        .set('Authorization', `Bearer ${second.body.data.accessToken}`)
        .expect(200)
    })

    it('refresh 接口拒绝非白名单来源', async () => {
      const loginResponse = await request(app.getHttpServer())
        .post(`${apiUrl}/login`)
        .send({ email: student.email, password: student.password })
        .expect(200)

      const cookie = extractRefreshCookie(loginResponse)

      await request(app.getHttpServer())
        .post(`${apiUrl}/refresh`)
        .set('Origin', 'http://evil.test')
        .set('Cookie', cookie)
        .expect(403)
        .expect(({ body }) => {
          expect(body.code).toBe(40300)
        })
    })

    it('refresh 接口放行白名单来源', async () => {
      const loginResponse = await request(app.getHttpServer())
        .post(`${apiUrl}/login`)
        .send({ email: student.email, password: student.password })
        .expect(200)

      const cookie = extractRefreshCookie(loginResponse)

      await request(app.getHttpServer())
        .post(`${apiUrl}/refresh`)
        .set('Origin', 'http://localhost:5173')
        .set('Cookie', cookie)
        .expect(200)
    })

    it('缺少 Refresh Cookie 时刷新返回 40102', async () => {
      await request(app.getHttpServer())
        .post(`${apiUrl}/refresh`)
        .expect(401)
        .expect(({ body }) => {
          expect(body.code).toBe(40102)
        })
    })

    it('退出登录后旧的 Refresh Token 不可再用', async () => {
      const loginResponse = await request(app.getHttpServer())
        .post(`${apiUrl}/login`)
        .send({ email: student.email, password: student.password })
        .expect(200)

      const cookie = extractRefreshCookie(loginResponse)

      await request(app.getHttpServer())
        .post(`${apiUrl}/logout`)
        .set('Cookie', cookie)
        .expect(200)
        .expect(({ body }) => {
          expect(body.data).toBe(true)
        })

      await request(app.getHttpServer()).post(`${apiUrl}/refresh`).set('Cookie', cookie).expect(401)
    })

    it('无 Refresh Cookie 时，退出登录仍能撤销当前 Access Token', async () => {
      const loginResponse = await request(app.getHttpServer())
        .post(`${apiUrl}/login`)
        .send({ email: student.email, password: student.password })
        .expect(200)

      const accessToken = loginResponse.body.data.accessToken as string

      // 只带 Access Token，不带 Refresh Cookie
      await request(app.getHttpServer())
        .post(`${apiUrl}/logout`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)

      // 退出前的 Access Token 必须立即失效
      await request(app.getHttpServer())
        .get(`${apiUrl}/me`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(401)
        .expect(({ body }) => {
          expect(body.code).toBe(40101)
        })
    })

    it('被禁用用户无法通过刷新获取新的 Access Token', async () => {
      // 手动为禁用用户建立一个有效会话
      const tokenService = new TokenService()
      const refresh = tokenService.generateRefreshToken()

      prismaFake.sessions.push({
        id: 'session-disabled',
        userId: 'user-disabled',
        refreshTokenHash: refresh.hash,
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
        lastUsedAt: null,
        ipAddress: null,
        userAgent: null,
      })

      await request(app.getHttpServer())
        .post(`${apiUrl}/refresh`)
        .set('Cookie', `refresh_token=${refresh.token}`)
        .expect(403)
    })
  })
})
