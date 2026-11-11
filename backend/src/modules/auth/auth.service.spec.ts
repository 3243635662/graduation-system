import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common'
import * as argon2 from 'argon2'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PrismaService } from '../../prisma/prisma.service.js'
import { AuthService } from './auth.service.js'
import type { EmailCodeService } from './email-code/email-code.service.js'
import { TokenService } from './services/token.service.js'

interface PrismaMock {
  $transaction: ReturnType<typeof vi.fn>
  user: {
    findUnique: ReturnType<typeof vi.fn>
    create: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
  }
  role: { findUnique: ReturnType<typeof vi.fn> }
  userRole: { create: ReturnType<typeof vi.fn> }
  authSession: {
    create: ReturnType<typeof vi.fn>
    findUnique: ReturnType<typeof vi.fn>
    updateMany: ReturnType<typeof vi.fn>
  }
}

function createPrismaMock(): PrismaMock {
  const mock: PrismaMock = {
    $transaction: vi.fn(),
    user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    role: { findUnique: vi.fn() },
    userRole: { create: vi.fn() },
    authSession: {
      create: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
  }

  mock.$transaction.mockImplementation(async (callback: (tx: PrismaMock) => unknown) =>
    callback(mock),
  )

  return mock
}

const studentRole = { id: 'role-student', code: 'STUDENT', name: '学生' }

const baseUser = {
  id: 'user-1',
  email: 'student@example.com',
  displayName: '张三',
  status: 'ACTIVE' as const,
}

describe('AuthService', () => {
  let prisma: PrismaMock
  let tokenService: TokenService
  let emailCodeService: { verifyAndConsumeRegisterCode: ReturnType<typeof vi.fn> }
  let service: AuthService

  beforeEach(() => {
    process.env['JWT_ACCESS_SECRET'] = 'unit-test-secret'
    prisma = createPrismaMock()
    tokenService = new TokenService()
    emailCodeService = { verifyAndConsumeRegisterCode: vi.fn().mockResolvedValue(undefined) }
    service = new AuthService(
      prisma as unknown as PrismaService,
      tokenService,
      emailCodeService as unknown as EmailCodeService,
    )
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('register', () => {
    const registerInput = {
      displayName: '张三',
      email: 'student@example.com',
      emailCode: '123456',
      password: 'password123',
      confirmPassword: 'password123',
    }

    it('创建用户、关联 STUDENT 角色并建立会话', async () => {
      prisma.user.findUnique.mockResolvedValue(null)
      prisma.role.findUnique.mockResolvedValue(studentRole)
      prisma.user.create.mockResolvedValue(baseUser)
      prisma.userRole.create.mockResolvedValue({})
      prisma.authSession.create.mockResolvedValue({ id: 'session-1' })

      const result = await service.register(registerInput, {})

      expect(result.user.roles).toEqual([studentRole])
      expect(result.refreshToken).toBeTruthy()

      const payload = tokenService.verifyAccessToken(result.accessToken)
      expect(payload.sub).toBe('user-1')
      expect(payload.sid).toBe('session-1')

      expect(prisma.userRole.create).toHaveBeenCalledWith({
        data: { userId: 'user-1', roleId: studentRole.id },
      })
      expect(emailCodeService.verifyAndConsumeRegisterCode).toHaveBeenCalledWith({
        email: 'student@example.com',
        code: '123456',
      })
    })

    it('验证码校验失败时不创建用户', async () => {
      prisma.user.findUnique.mockResolvedValue(null)
      emailCodeService.verifyAndConsumeRegisterCode.mockRejectedValue(
        new BadRequestException({ code: 40011, data: null, message: '邮箱验证码不正确' }),
      )

      await expect(service.register(registerInput, {})).rejects.toBeInstanceOf(BadRequestException)
      expect(prisma.user.create).not.toHaveBeenCalled()
      expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('邮箱已存在时抛出 ConflictException，且不消耗验证码', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'existing' })

      await expect(service.register(registerInput, {})).rejects.toBeInstanceOf(ConflictException)
      expect(emailCodeService.verifyAndConsumeRegisterCode).not.toHaveBeenCalled()
    })
  })

  describe('login', () => {
    it('密码正确时签发 Access Token 并创建会话', async () => {
      const passwordHash = await argon2.hash('password123', { type: argon2.argon2id })

      prisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        passwordHash,
        userRoles: [{ role: studentRole }],
      })
      prisma.authSession.create.mockResolvedValue({ id: 'session-1' })
      prisma.user.update.mockResolvedValue({})

      const result = await service.login({ email: baseUser.email, password: 'password123' }, {})

      expect(result.user.id).toBe('user-1')
      expect(result.user.roles).toEqual([studentRole])
      expect(tokenService.verifyAccessToken(result.accessToken).sid).toBe('session-1')
    })

    it('用户不存在与密码错误返回相同的错误信息', async () => {
      const passwordHash = await argon2.hash('password123', { type: argon2.argon2id })

      prisma.user.findUnique.mockResolvedValue(null)
      const missingUserError = await service
        .login({ email: 'none@example.com', password: 'wrong' }, {})
        .catch((error: unknown) => error)

      prisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        passwordHash,
        userRoles: [],
      })
      const wrongPasswordError = await service
        .login({ email: baseUser.email, password: 'wrong' }, {})
        .catch((error: unknown) => error)

      expect(missingUserError).toBeInstanceOf(UnauthorizedException)
      expect(wrongPasswordError).toBeInstanceOf(UnauthorizedException)
      expect((missingUserError as Error).message).toBe((wrongPasswordError as Error).message)
    })

    it('被禁用的用户无法登录', async () => {
      const passwordHash = await argon2.hash('password123', { type: argon2.argon2id })

      prisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        status: 'DISABLED',
        passwordHash,
        userRoles: [],
      })

      await expect(
        service.login({ email: baseUser.email, password: 'password123' }, {}),
      ).rejects.toBeInstanceOf(ForbiddenException)
    })
  })

  describe('refresh', () => {
    const activeSession = {
      id: 'session-1',
      userId: 'user-1',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user: { ...baseUser, userRoles: [{ role: studentRole }] },
    }

    it('有效 Refresh Token 会轮换并签发新的 Access Token', async () => {
      const current = tokenService.generateRefreshToken()

      prisma.authSession.findUnique.mockResolvedValue(activeSession)
      prisma.authSession.updateMany.mockResolvedValue({ count: 1 })

      const result = await service.refresh(current.token)

      expect(result.refreshToken).not.toBe(current.token)
      expect(result.user.id).toBe('user-1')
      expect(prisma.authSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ refreshTokenHash: current.hash }),
        }),
      )
    })

    it('Refresh Token 缺失或无效时抛出 40102', async () => {
      prisma.authSession.findUnique.mockResolvedValue(null)

      await expect(service.refresh(null)).rejects.toMatchObject({ status: 401 })
      await expect(service.refresh('unknown')).rejects.toMatchObject({ status: 401 })
    })

    it('已撤销的会话无法刷新', async () => {
      prisma.authSession.findUnique.mockResolvedValue({
        ...activeSession,
        revokedAt: new Date(),
      })

      await expect(service.refresh('token')).rejects.toMatchObject({ status: 401 })
    })

    it('两个标签页并发刷新复用同一次轮换，不会误撤销会话', async () => {
      const current = tokenService.generateRefreshToken()

      prisma.authSession.findUnique.mockResolvedValue(activeSession)
      prisma.authSession.updateMany.mockResolvedValue({ count: 1 })

      const [first, second] = await Promise.all([
        service.refresh(current.token),
        service.refresh(current.token),
      ])

      expect(first.refreshToken).toBe(second.refreshToken)
      expect(prisma.authSession.updateMany).toHaveBeenCalledTimes(1)
    })

    it('宽限期内重复提交同一 Token 幂等返回', async () => {
      const current = tokenService.generateRefreshToken()

      prisma.authSession.findUnique.mockResolvedValue(activeSession)
      prisma.authSession.updateMany.mockResolvedValue({ count: 1 })

      const first = await service.refresh(current.token)
      const second = await service.refresh(current.token)

      expect(second.refreshToken).toBe(first.refreshToken)
      expect(prisma.authSession.updateMany).toHaveBeenCalledTimes(1)
    })

    it('旧 Token 被并发轮换后，宽限期内可幂等恢复', async () => {
      const current = tokenService.generateRefreshToken()

      prisma.authSession.findUnique.mockResolvedValueOnce(activeSession)
      prisma.authSession.updateMany.mockResolvedValue({ count: 1 })

      const first = await service.refresh(current.token)

      // 旧哈希已被轮换，数据库查不到 —— 应命中宽限缓存
      prisma.authSession.findUnique.mockResolvedValueOnce(null)
      const second = await service.refresh(current.token)

      expect(second.refreshToken).toBe(first.refreshToken)
      expect(prisma.authSession.updateMany).toHaveBeenCalledTimes(1)
    })

    it('宽限期外重放旧令牌会撤销会话', async () => {
      const current = tokenService.generateRefreshToken()

      prisma.authSession.findUnique.mockResolvedValue(activeSession)
      prisma.authSession.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 1 })

      await service.refresh(current.token)

      vi.useFakeTimers()
      vi.setSystemTime(Date.now() + 31_000)

      await expect(service.refresh(current.token)).rejects.toMatchObject({ status: 401 })

      expect(prisma.authSession.updateMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ revokedAt: null }),
          data: expect.objectContaining({ revokedAt: expect.any(Date) }),
        }),
      )
    })

    it('用户被禁用后无法刷新，并撤销会话', async () => {
      prisma.authSession.findUnique.mockResolvedValue({
        ...activeSession,
        user: { ...baseUser, status: 'DISABLED', userRoles: [] },
      })
      prisma.authSession.updateMany.mockResolvedValue({ count: 1 })

      await expect(service.refresh('token')).rejects.toBeInstanceOf(ForbiddenException)
      expect(prisma.authSession.updateMany).toHaveBeenCalled()
    })
  })

  describe('logout', () => {
    it('撤销当前 Refresh Token 对应的会话', async () => {
      prisma.authSession.findUnique.mockResolvedValue({ id: 'session-1' })
      prisma.authSession.updateMany.mockResolvedValue({ count: 1 })

      await service.logout({ refreshToken: 'refresh-token', accessToken: null })

      expect(prisma.authSession.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['session-1'] }, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      })
    })

    it('无 Refresh Cookie 时通过 Access Token 的 sid 撤销会话', async () => {
      const accessToken = tokenService.signAccessToken('user-1', 'session-1')

      prisma.authSession.updateMany.mockResolvedValue({ count: 1 })

      await service.logout({ refreshToken: null, accessToken })

      expect(prisma.authSession.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['session-1'] }, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      })
      expect(prisma.authSession.findUnique).not.toHaveBeenCalled()
    })

    it('令牌缺失时安全返回', async () => {
      await expect(
        service.logout({ refreshToken: null, accessToken: null }),
      ).resolves.toBeUndefined()
      expect(prisma.authSession.updateMany).not.toHaveBeenCalled()
    })
  })

  describe('getMe', () => {
    it('返回当前用户与角色', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        userRoles: [{ role: studentRole }],
      })

      const result = await service.getMe({ userId: 'user-1', sessionId: 'session-1' })

      expect(result).toEqual({ ...baseUser, roles: [studentRole] })
    })

    it('用户不存在时抛出 40101', async () => {
      prisma.user.findUnique.mockResolvedValue(null)

      await expect(
        service.getMe({ userId: 'missing', sessionId: 'session-1' }),
      ).rejects.toMatchObject({ status: 401 })
    })
  })
})
