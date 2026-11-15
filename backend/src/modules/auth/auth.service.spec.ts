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
  /** 登录标识解析：学号 / 教师工号 / 工作人员工号 */
  studentProfile: { findUnique: ReturnType<typeof vi.fn> }
  teacherProfile: { findUnique: ReturnType<typeof vi.fn> }
  personnelProfile: { findUnique: ReturnType<typeof vi.fn> }
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
    studentProfile: { findUnique: vi.fn().mockResolvedValue(null) },
    teacherProfile: { findUnique: vi.fn().mockResolvedValue(null) },
    personnelProfile: { findUnique: vi.fn().mockResolvedValue(null) },
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

/** 认证响应中的角色摘要：附带组织范围与有效期，便于前端展示任职范围 */
const studentRoleSummary = { ...studentRole, scopeOrgUnitId: null, validUntil: null }

/**
 * 学生角色分配：用于 userProfileSelect 的有效分配过滤
 *
 * 当前授权表只保存仍然有效的分配（撤销即删除行），
 * 因此这里不再有 revokedAt 字段；rolePermissions 用于汇总权限编码。
 */
const studentAssignment = {
  scopeOrgUnitId: null,
  validFrom: new Date('2026-01-01T00:00:00.000Z'),
  validUntil: null,
  role: { ...studentRole, status: 'ACTIVE' as const, rolePermissions: [] },
  scopeOrgUnit: null,
}

const baseUser = {
  id: 'user-1',
  email: 'student@example.com',
  phone: null,
  realName: '张三',
  avatarUrl: null,
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
      realName: '张三',
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

      // 学生注册不绑定组织节点，范围键固定为 GLOBAL
      expect(prisma.userRole.create).toHaveBeenCalledWith({
        data: { userId: 'user-1', roleId: studentRole.id, scopeKey: 'GLOBAL' },
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
        userRoles: [studentAssignment],
      })
      prisma.authSession.create.mockResolvedValue({ id: 'session-1' })
      prisma.user.update.mockResolvedValue({})

      const result = await service.login(
        { identifier: baseUser.email, password: 'password123' },
        {},
      )

      expect(result.user.id).toBe('user-1')
      expect(result.user.roles).toEqual([studentRoleSummary])
      expect(tokenService.verifyAccessToken(result.accessToken).sid).toBe('session-1')
    })

    it('用户不存在与密码错误返回相同的错误信息', async () => {
      const passwordHash = await argon2.hash('password123', { type: argon2.argon2id })

      prisma.user.findUnique.mockResolvedValue(null)
      const missingUserError = await service
        .login({ identifier: 'none@example.com', password: 'wrong' }, {})
        .catch((error: unknown) => error)

      prisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        passwordHash,
        userRoles: [],
      })
      const wrongPasswordError = await service
        .login({ identifier: baseUser.email, password: 'wrong' }, {})
        .catch((error: unknown) => error)

      expect(missingUserError).toBeInstanceOf(UnauthorizedException)
      expect(wrongPasswordError).toBeInstanceOf(UnauthorizedException)
      expect((missingUserError as Error).message).toBe((wrongPasswordError as Error).message)
      expect((missingUserError as Error).message).toBe('账号或密码错误')
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
        service.login({ identifier: baseUser.email, password: 'password123' }, {}),
      ).rejects.toBeInstanceOf(ForbiddenException)
    })

    it('非邮箱标识按学号解析到对应账号', async () => {
      const passwordHash = await argon2.hash('password123', { type: argon2.argon2id })

      prisma.studentProfile.findUnique.mockResolvedValue({ userId: 'user-1' })
      prisma.user.findUnique.mockResolvedValue({
        ...baseUser,
        passwordHash,
        userRoles: [studentAssignment],
      })
      prisma.authSession.create.mockResolvedValue({ id: 'session-1' })
      prisma.user.update.mockResolvedValue({})

      const result = await service.login({ identifier: '2024001', password: 'password123' }, {})

      expect(prisma.studentProfile.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { studentNo: '2024001' } }),
      )
      expect(result.user.id).toBe('user-1')
    })
  })

  describe('refresh', () => {
    const activeSession = {
      id: 'session-1',
      userId: 'user-1',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user: { ...baseUser, userRoles: [studentAssignment] },
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
        userRoles: [studentAssignment],
      })

      const result = await service.getMe({ userId: 'user-1', sessionId: 'session-1' })

      expect(result).toEqual({
        ...baseUser,
        roles: [studentRoleSummary],
        permissions: [],
      })
    })

    it('用户不存在时抛出 40101', async () => {
      prisma.user.findUnique.mockResolvedValue(null)

      await expect(
        service.getMe({ userId: 'missing', sessionId: 'session-1' }),
      ).rejects.toMatchObject({ status: 401 })
    })
  })
})
