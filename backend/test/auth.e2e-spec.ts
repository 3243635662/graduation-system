import { API_PREFIX } from '@graduation/shared'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import * as argon2 from 'argon2'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { beforeAll, afterAll, describe, expect, it } from 'vitest'

import { configureGlobalEnhancers } from '../src/common/configure-global-enhancers.js'
import { RateLimitGuard } from '../src/common/rate-limit/rate-limit.guard.js'
import { AuthController } from '../src/modules/auth/auth.controller.js'
import { AuthService } from '../src/modules/auth/auth.service.js'
import { AccessTokenGuard } from '../src/modules/auth/guards/access-token.guard.js'
import { OriginGuard } from '../src/modules/auth/guards/origin.guard.js'
import { TokenService } from '../src/modules/auth/services/token.service.js'
import { PrismaService } from '../src/prisma/prisma.service.js'

interface FakeUser {
  id: string
  email: string
  passwordHash: string
  displayName: string
  status: 'ACTIVE' | 'DISABLED' | 'LOCKED'
  lastLoginAt: Date | null
}

interface FakeSession {
  id: string
  userId: string
  refreshTokenHash: string
  expiresAt: Date
  revokedAt: Date | null
  lastUsedAt: Date | null
  ipAddress: string | null
  userAgent: string | null
}

const STUDENT_ROLE = { id: 'role-student', code: 'STUDENT', name: '学生' }

/**
 * 内存版 Prisma 假实现
 *
 * 只覆盖 Auth 模块使用到的方法，用于在不连接真实数据库的前提下验证完整链路。
 */
function createInMemoryPrisma() {
  const users: FakeUser[] = []
  const sessions: FakeSession[] = []
  const userRoles: Array<{ userId: string; roleId: string }> = []
  let sequence = 0

  const nextId = (prefix: string) => `${prefix}-${++sequence}`

  const withRoles = (user: FakeUser) => {
    const roleIds = userRoles.filter((item) => item.userId === user.id).map((item) => item.roleId)

    const roles = roleIds.map((roleId) => (roleId === STUDENT_ROLE.id ? STUDENT_ROLE : undefined))

    return {
      ...user,
      userRoles: roles
        .filter((role): role is typeof STUDENT_ROLE => Boolean(role))
        .map((role) => ({ role })),
    }
  }

  const matchesSession = (session: FakeSession, where: Record<string, unknown>) => {
    const idCondition = where['id']

    if (typeof idCondition === 'string' && session.id !== idCondition) return false

    if (idCondition && typeof idCondition === 'object' && 'in' in idCondition) {
      const ids = (idCondition as { in: string[] }).in

      if (!ids.includes(session.id)) return false
    }

    if (
      typeof where['refreshTokenHash'] === 'string' &&
      session.refreshTokenHash !== where['refreshTokenHash']
    ) {
      return false
    }

    if (where['revokedAt'] === null && session.revokedAt !== null) return false

    return true
  }

  const prisma = {
    // tx 即假实现自身；用 unknown 避免在对象初始化器里自引用 typeof prisma
    $transaction: async (callback: (tx: unknown) => unknown) => callback(prisma),

    user: {
      async findUnique({ where }: { where: { id?: string; email?: string } }) {
        const user = where.email
          ? users.find((item) => item.email === where.email)
          : users.find((item) => item.id === where.id)

        return user ? withRoles(user) : null
      },

      async create({ data }: { data: Omit<FakeUser, 'id' | 'lastLoginAt'> }) {
        const user: FakeUser = {
          id: nextId('user'),
          lastLoginAt: null,
          ...data,
        }

        users.push(user)

        return user
      },

      async update({ where, data }: { where: { id: string }; data: Partial<FakeUser> }) {
        const user = users.find((item) => item.id === where.id)

        if (!user) throw new Error('user not found')

        Object.assign(user, data)

        return user
      },
    },

    role: {
      async findUnique({ where }: { where: { code: string } }) {
        return where.code === STUDENT_ROLE.code ? STUDENT_ROLE : null
      },
    },

    userRole: {
      async create({ data }: { data: { userId: string; roleId: string } }) {
        userRoles.push(data)
        return data
      },
    },

    authSession: {
      async create({ data }: { data: Omit<FakeSession, 'id' | 'revokedAt' | 'lastUsedAt'> }) {
        const session: FakeSession = {
          id: nextId('session'),
          revokedAt: null,
          lastUsedAt: null,
          ...data,
        }

        sessions.push(session)

        return session
      },

      async findUnique({ where }: { where: { id?: string; refreshTokenHash?: string } }) {
        const session = where.id
          ? sessions.find((item) => item.id === where.id)
          : sessions.find((item) => item.refreshTokenHash === where.refreshTokenHash)

        if (!session) return null

        const user = users.find((item) => item.id === session.userId)

        return { ...session, user: user ? withRoles(user) : null }
      },

      async updateMany({
        where,
        data,
      }: {
        where: Record<string, unknown>
        data: Partial<FakeSession>
      }) {
        let count = 0

        for (const session of sessions) {
          if (!matchesSession(session, where)) continue

          Object.assign(session, data)
          count += 1
        }

        return { count }
      },
    },
  }

  return { prisma, users, sessions }
}

function extractRefreshCookie(response: request.Response): string {
  const header = response.headers['set-cookie']
  const cookies = Array.isArray(header) ? header : header ? [header] : []
  const cookie = cookies.find((item) => item.startsWith('refresh_token='))

  return cookie?.split(';')[0] ?? ''
}

describe('Auth (e2e)', () => {
  let app: INestApplication<App>
  let prismaFake: ReturnType<typeof createInMemoryPrisma>

  const apiUrl = `/${API_PREFIX}/auth`
  const student = {
    displayName: '测试学生',
    email: 'e2e-student@example.com',
    password: 'password123',
    confirmPassword: 'password123',
  }

  beforeAll(async () => {
    process.env['JWT_ACCESS_SECRET'] = 'e2e-test-secret'
    process.env['ACCESS_TOKEN_TTL_SECONDS'] = '900'
    process.env['REFRESH_TOKEN_TTL_DAYS'] = '7'
    process.env['REFRESH_ROTATION_GRACE_MS'] = '30000'
    process.env['CORS_ORIGIN'] = 'http://localhost:5173'

    prismaFake = createInMemoryPrisma()

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
        { provide: PrismaService, useValue: prismaFake.prisma },
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
    await app.close()
  })

  it('注册成功后直接建立登录态并下发 Refresh Cookie', async () => {
    const response = await request(app.getHttpServer())
      .post(`${apiUrl}/register`)
      .send(student)
      .expect(201)

    expect(response.body.code).toBe(0)
    expect(response.body.data.accessToken).toBeTruthy()
    expect(response.body.data.user.email).toBe(student.email)
    expect(response.body.data.user.roles).toEqual([STUDENT_ROLE])
    expect(extractRefreshCookie(response)).toMatch(/^refresh_token=/)
  })

  it('重复邮箱注册返回 409', async () => {
    await request(app.getHttpServer())
      .post(`${apiUrl}/register`)
      .send(student)
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
        password: 'short',
        confirmPassword: 'different',
      })
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe(40001)

        const paths = (body.data as Array<{ path: string }>).map((issue) => issue.path)

        expect(paths).toEqual(
          expect.arrayContaining(['displayName', 'email', 'password', 'confirmPassword']),
        )
      })
  })

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
