import type { AuthUser, RoleSummary } from '@graduation/shared'
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common'
import * as argon2 from 'argon2'

import { PrismaService } from '../../prisma/prisma.service.js'
import { EmailCodeService } from './email-code/email-code.service.js'
import type { LoginInput } from './schemas/login.schema.js'
import type { RegisterInput } from './schemas/register.schema.js'
import type { ResetPasswordInput } from './schemas/reset-password.schema.js'
import { TokenService } from './services/token.service.js'
import type { AuthUserContext } from './types/auth-user.type.js'

/** 会话元信息，用于审计 */
export interface SessionMeta {
  ipAddress?: string | null
  userAgent?: string | null
}

/** 服务层返回的完整会话（含原始 Refresh Token，仅供 Controller 写入 Cookie） */
export interface SessionResult {
  accessToken: string
  refreshToken: string
  user: AuthUser
}

/** 登录用户的必要字段 */
interface UserProfileRecord {
  id: string
  email: string | null
  phone: string | null
  realName: string
  avatarUrl: string | null
  status: 'ACTIVE' | 'DISABLED' | 'LOCKED'
  studentProfile?: {
    studentNo: string
    class?: { name: string } | null
  } | null
  personnelProfile?: {
    primaryOrganization?: { name: string } | null
    teacherProfile?: {
      teacherNo: string
      title: string | null
    } | null
  } | null
}

/** 用户 + 角色分配的查询结构 */
type UserWithRoles = UserProfileRecord & {
  userRoles: Array<{
    scopeOrgUnitId: string | null
    validFrom: Date
    validUntil: Date | null
    role: {
      id: string
      code: string
      name: string
      status: 'ACTIVE' | 'DISABLED'
      rolePermissions: Array<{ permission: { code: string } }>
    }
    scopeOrgUnit: { name: string; type: string } | null
  }>
}

/** 宽限期内缓存的轮换结果，用于消除多标签页并发刷新的误判 */
interface RecentRotation {
  sessionId: string
  userId: string
  user: UserWithRoles
  refreshToken: string
  completedAt: number
}

const STUDENT_ROLE_CODE = 'STUDENT'

/** 避免用户不存在时提前返回造成的时序差异 */
let dummyPasswordHashPromise: Promise<string> | null = null

function getDummyPasswordHash(): Promise<string> {
  dummyPasswordHashPromise ??= argon2.hash('timing-safe-dummy-password', {
    type: argon2.argon2id,
  })

  return dummyPasswordHashPromise
}

function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id })
}

function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return argon2.verify(passwordHash, password)
}

/**
 * 只返回当前有效的角色分配
 *
 * 撤销、未生效、已过期与角色停用的记录一律不返回。
 * 同一角色在不同组织范围的多条分配会分别保留（例如两个班级的协管员）。
 */
function toEffectiveRoles(user: UserWithRoles, now = new Date()): RoleSummary[] {
  const roles = new Map<string, RoleSummary>()

  for (const item of user.userRoles) {
    if (item.validFrom.getTime() > now.getTime()) continue
    if (item.validUntil && item.validUntil.getTime() <= now.getTime()) continue
    if (item.role.status !== 'ACTIVE') continue

    const key = `${item.role.code}:${item.scopeOrgUnitId ?? 'none'}`

    if (roles.has(key)) continue

    roles.set(key, {
      id: item.role.id,
      code: item.role.code,
      name: item.role.name,
      scopeOrgUnitId: item.scopeOrgUnitId,
      ...(item.scopeOrgUnit
        ? { scopeOrgUnitName: item.scopeOrgUnit.name, scopeOrgUnitType: item.scopeOrgUnit.type }
        : {}),
      validUntil: item.validUntil ? item.validUntil.toISOString() : null,
    })
  }

  return [...roles.values()]
}

/**
 * 汇总当前有效角色的功能权限编码。
 *
 * 这里只做「角色模板 → 权限编码」的并集，用于 /auth/me 供前端展示入口；
 * 组织范围、协管资格等实时校验仍由 PermissionsGuard 在每次请求时完成。
 */
function toPermissionCodes(user: UserWithRoles, now = new Date()): string[] {
  const codes = new Set<string>()

  for (const item of user.userRoles) {
    if (item.validFrom.getTime() > now.getTime()) continue
    if (item.validUntil && item.validUntil.getTime() <= now.getTime()) continue
    if (item.role.status !== 'ACTIVE') continue

    for (const rolePermission of item.role.rolePermissions) {
      codes.add(rolePermission.permission.code)
    }
  }

  return [...codes].sort()
}

function toAuthUser(
  user: UserProfileRecord,
  roles: RoleSummary[],
  permissions: string[],
): AuthUser {
  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    realName: user.realName,
    avatarUrl: user.avatarUrl,
    status: user.status,
    roles,
    permissions,
    studentNo: user.studentProfile?.studentNo ?? null,
    className: user.studentProfile?.class?.name ?? null,
    teacherNo: user.personnelProfile?.teacherProfile?.teacherNo ?? null,
    title: user.personnelProfile?.teacherProfile?.title ?? null,
    organizationName: user.personnelProfile?.primaryOrganization?.name ?? null,
  }
}

const userProfileSelect = {
  id: true,
  email: true,
  phone: true,
  realName: true,
  avatarUrl: true,
  status: true,
  studentProfile: {
    select: {
      studentNo: true,
      class: {
        select: {
          name: true,
        },
      },
    },
  },
  personnelProfile: {
    select: {
      primaryOrganization: {
        select: {
          name: true,
        },
      },
      teacherProfile: {
        select: {
          teacherNo: true,
          title: true,
        },
      },
    },
  },
  userRoles: {
    select: {
      scopeOrgUnitId: true,
      validFrom: true,
      validUntil: true,
      role: {
        select: {
          id: true,
          code: true,
          name: true,
          status: true,
          rolePermissions: {
            select: {
              permission: {
                select: { code: true },
              },
            },
          },
        },
      },
      scopeOrgUnit: {
        select: {
          name: true,
          type: true,
        },
      },
    },
  },
} as const

/** 登录校验所需的用户结构（含密码哈希，仅用于本地比对，绝不出参） */
type UserWithPassword = UserWithRoles & { passwordHash: string }

@Injectable()
export class AuthService {
  /** 同一实例内正在进行的轮换，用于合并并发刷新（例如两个标签页同时刷新） */
  private readonly pendingRotations = new Map<string, Promise<SessionResult>>()

  /**
   * 已轮换的旧令牌哈希 → 轮换结果（宽限期内幂等复用）。
   *
   * 仅保存在内存中：单体部署下足以消除并发误判；
   * 多实例部署时需替换为 Redis 等共享存储。
   */
  private readonly recentRotations = new Map<string, RecentRotation>()

  /** 轮换宽限期（毫秒），默认 30 秒 */
  private readonly rotationGraceMs: number

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly emailCodeService: EmailCodeService,
  ) {
    const grace = Number(process.env['REFRESH_ROTATION_GRACE_MS'] ?? 30_000)
    this.rotationGraceMs = Number.isFinite(grace) && grace >= 0 ? grace : 30_000
  }

  /**
   * 学生注册
   *
   * - 必须先通过邮箱验证码校验：Redis 原子校验并消费，失败即拒绝注册
   * - 角色固定为 STUDENT，忽略任何客户端传入的角色字段
   * - 用户、角色关联、会话在同一事务内创建
   *
   * 注意：Redis 与数据库不是同一个事务系统。验证码消费成功但事务失败时，
   * 用户需要重新获取验证码，这是可接受的；反过来绝不允许「未验证就注册成功」。
   */
  async register(input: RegisterInput, meta: SessionMeta): Promise<SessionResult> {
    // 先查重复，避免白白消耗一次有效验证码
    const existing = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    })

    if (existing) {
      throw new ConflictException('该邮箱已被注册')
    }

    // 原子校验并消费验证码；Redis 不可用时抛出 503，绝不降级放行
    await this.emailCodeService.verifyAndConsumeRegisterCode({
      email: input.email,
      code: input.emailCode,
    })

    const passwordHash = await hashPassword(input.password)
    const refresh = this.tokenService.generateRefreshToken()
    const expiresAt = new Date(Date.now() + this.tokenService.getRefreshTtlMs())

    const result = await this.prisma.$transaction(async (tx) => {
      // 事务内再查一次，兜住「验证码校验后、事务开始前」的并发注册
      const duplicated = await tx.user.findUnique({
        where: { email: input.email },
        select: { id: true },
      })

      if (duplicated) {
        throw new ConflictException('该邮箱已被注册')
      }

      const studentRole = await tx.role.findUnique({
        where: { code: STUDENT_ROLE_CODE },
        select: { id: true, code: true, name: true },
      })

      if (!studentRole) {
        throw new InternalServerErrorException('系统角色未初始化，请先执行数据库 Seed')
      }

      const user = await tx.user.create({
        data: {
          email: input.email,
          passwordHash,
          realName: input.realName,
          emailVerifiedAt: new Date(),
          status: 'ACTIVE',
        },
        select: {
          id: true,
          email: true,
          phone: true,
          realName: true,
          avatarUrl: true,
          status: true,
        },
      })

      await tx.userRole.create({
        data: {
          userId: user.id,
          roleId: studentRole.id,
          scopeKey: 'GLOBAL',
        },
      })

      const session = await tx.authSession.create({
        data: {
          userId: user.id,
          refreshTokenHash: refresh.hash,
          expiresAt,
          ipAddress: meta.ipAddress ?? null,
          userAgent: meta.userAgent ?? null,
        },
        select: { id: true },
      })

      return { user, role: studentRole, sessionId: session.id }
    })

    const accessToken = this.tokenService.signAccessToken(result.user.id, result.sessionId)

    return {
      accessToken,
      refreshToken: refresh.token,
      user: toAuthUser(result.user, [result.role], []),
    }
  }

  /**
   * 邮箱验证码重置/修改密码
   *
   * 1. 验证并原子消费重置密码验证码（一次性、防暴力破解）
   * 2. 查询用户并校验状态
   * 3. 计算 Argon2id 哈希更新密码
   * 4. 撤销该用户现有的全部会话，强制重新登录
   */
  async resetPassword(input: ResetPasswordInput, _meta: SessionMeta): Promise<void> {
    const email = input.email.trim().toLowerCase()

    await this.emailCodeService.verifyAndConsumePasswordResetCode({
      email,
      code: input.emailCode,
    })

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, status: true },
    })

    if (!user) {
      throw new BadRequestException('该邮箱尚未注册或账号不存在')
    }

    if (user.status !== 'ACTIVE') {
      throw new ForbiddenException('账号已被禁用或锁定，无法修改密码')
    }

    const passwordHash = await hashPassword(input.password)

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash },
      })

      await tx.authSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      })
    })
  }

  /**
   * 登录
   *
   * 账号不存在与密码错误返回同一错误信息，避免账号枚举。
   */
  async login(input: LoginInput, meta: SessionMeta): Promise<SessionResult> {
    const user = await this.resolveLoginUser(input.identifier)

    const passwordHash = user?.passwordHash ?? (await getDummyPasswordHash())
    const passwordValid = await verifyPassword(passwordHash, input.password)

    if (!user || !passwordValid) {
      throw new UnauthorizedException('账号或密码错误')
    }

    if (user.status !== 'ACTIVE') {
      throw new ForbiddenException('账号已被禁用，请联系管理员')
    }

    const refresh = this.tokenService.generateRefreshToken()
    const expiresAt = new Date(Date.now() + this.tokenService.getRefreshTtlMs())

    const session = await this.prisma.authSession.create({
      data: {
        userId: user.id,
        refreshTokenHash: refresh.hash,
        expiresAt,
        ipAddress: meta.ipAddress ?? null,
        userAgent: meta.userAgent ?? null,
      },
      select: { id: true },
    })

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    })

    const accessToken = this.tokenService.signAccessToken(user.id, session.id)

    return {
      accessToken,
      refreshToken: refresh.token,
      user: toAuthUser(user, toEffectiveRoles(user), toPermissionCodes(user)),
    }
  }

  /**
   * 按登录标识解析用户。
   *
   * 解析顺序：邮箱（含 @）→ 学号 → 教师工号 → 工作人员工号。
   * 任一分支找不到都返回 null，由 login 统一返回「账号或密码错误」，
   * 避免通过响应差异枚举系统内是否存在某个学号或工号。
   */
  private async resolveLoginUser(identifier: string): Promise<UserWithPassword | null> {
    const value = identifier.trim()

    if (!value) return null

    if (value.includes('@')) {
      return this.prisma.user.findUnique({
        where: { email: value.toLowerCase() },
        select: { ...userProfileSelect, passwordHash: true },
      })
    }

    const student = await this.prisma.studentProfile.findUnique({
      where: { studentNo: value },
      select: { userId: true },
    })

    if (student) {
      return this.findUserWithPassword(student.userId)
    }

    const teacher = await this.prisma.teacherProfile.findUnique({
      where: { teacherNo: value },
      select: { personnelProfile: { select: { userId: true } } },
    })

    if (teacher) {
      return this.findUserWithPassword(teacher.personnelProfile.userId)
    }

    const personnel = await this.prisma.personnelProfile.findUnique({
      where: { employeeNo: value },
      select: { userId: true },
    })

    if (personnel) {
      return this.findUserWithPassword(personnel.userId)
    }

    return null
  }

  private findUserWithPassword(userId: string): Promise<UserWithPassword | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { ...userProfileSelect, passwordHash: true },
    })
  }

  /**
   * 刷新 Access Token 并轮换 Refresh Token
   *
   * 并发处理：
   * - 同一实例内的并发刷新复用同一次轮换（pendingRotations）
   * - 宽限期内的重复提交幂等返回上一次结果（recentRotations）
   * - 只有宽限期外再次使用旧令牌，才判定为重放并撤销会话
   */
  async refresh(refreshToken: string | null): Promise<SessionResult> {
    if (!refreshToken) {
      throw this.refreshInvalid('刷新令牌缺失')
    }

    const currentHash = this.tokenService.hashRefreshToken(refreshToken)

    const session = await this.prisma.authSession.findUnique({
      where: { refreshTokenHash: currentHash },
      select: {
        id: true,
        userId: true,
        revokedAt: true,
        expiresAt: true,
        user: { select: userProfileSelect },
      },
    })

    if (!session) {
      // 旧令牌可能刚被另一个标签页轮换：宽限期内幂等返回，不判定为攻击
      const recent = this.getRecentRotation(currentHash)

      if (recent) {
        return this.buildSessionResult(
          recent.sessionId,
          recent.userId,
          recent.refreshToken,
          recent.user,
        )
      }

      throw this.refreshInvalid('刷新令牌无效或已过期')
    }

    if (session.revokedAt || session.expiresAt.getTime() <= Date.now()) {
      throw this.refreshInvalid('刷新令牌无效或已过期')
    }

    if (session.user.status !== 'ACTIVE') {
      await this.revokeSession(session.id)
      throw new ForbiddenException('账号已被禁用，请联系管理员')
    }

    // 同一实例内的并发刷新：复用正在进行的轮换
    const pending = this.pendingRotations.get(session.id)

    if (pending) {
      return pending
    }

    // 数据库中仍能查到旧令牌，但该令牌已在宽限期内轮换过：幂等返回
    const recent = this.getRecentRotation(currentHash)

    if (recent && recent.sessionId === session.id) {
      return this.buildSessionResult(
        recent.sessionId,
        recent.userId,
        recent.refreshToken,
        recent.user,
      )
    }

    const rotation = this.rotateSession(session, currentHash)
    this.pendingRotations.set(session.id, rotation)

    try {
      return await rotation
    } finally {
      this.pendingRotations.delete(session.id)
    }
  }

  /**
   * 执行一次原子轮换。
   *
   * CAS 失败时先查宽限缓存，避免把「并发刷新」误判为「Token 重放」。
   */
  private async rotateSession(
    session: { id: string; userId: string; user: UserWithRoles },
    currentHash: string,
  ): Promise<SessionResult> {
    const next = this.tokenService.generateRefreshToken()
    const expiresAt = new Date(Date.now() + this.tokenService.getRefreshTtlMs())

    // 原子轮换：只有旧哈希仍然匹配时才更新，避免并发刷新产生多个有效令牌
    const rotated = await this.prisma.authSession.updateMany({
      where: {
        id: session.id,
        refreshTokenHash: currentHash,
        revokedAt: null,
      },
      data: {
        refreshTokenHash: next.hash,
        expiresAt,
        lastUsedAt: new Date(),
      },
    })

    if (rotated.count !== 1) {
      // 并发窗口内可能刚好被另一个请求完成轮换，先查宽限缓存
      const recent = this.getRecentRotation(currentHash)

      if (recent) {
        return this.buildSessionResult(
          recent.sessionId,
          recent.userId,
          recent.refreshToken,
          recent.user,
        )
      }

      // 宽限期外复用旧令牌：真正的重放，撤销会话
      await this.revokeSession(session.id)
      throw this.refreshInvalid('刷新令牌已失效，请重新登录')
    }

    this.rememberRotation(currentHash, {
      sessionId: session.id,
      userId: session.userId,
      user: session.user,
      refreshToken: next.token,
      completedAt: Date.now(),
    })

    return this.buildSessionResult(session.id, session.userId, next.token, session.user)
  }

  /**
   * 退出登录
   *
   * 优先使用已验证 Access Token 中的 sid 定位会话：
   * 即使浏览器没有携带 Refresh Cookie，也能撤销当前会话，让 Access Token 立即失效。
   * Refresh Cookie 作为补充依据一并撤销。
   *
   * 幂等：令牌缺失、会话不存在或已撤销时都不报错，由 Controller 负责清理 Cookie。
   */
  async logout(params: { refreshToken: string | null; accessToken: string | null }): Promise<void> {
    const sessionIds = new Set<string>()

    if (params.accessToken) {
      try {
        sessionIds.add(this.tokenService.verifyAccessToken(params.accessToken).sid)
      } catch {
        // Access Token 无效或过期时忽略，继续尝试 Refresh Cookie
      }
    }

    if (params.refreshToken) {
      const hash = this.tokenService.hashRefreshToken(params.refreshToken)

      const session = await this.prisma.authSession.findUnique({
        where: { refreshTokenHash: hash },
        select: { id: true },
      })

      if (session) {
        sessionIds.add(session.id)
      }
    }

    if (sessionIds.size === 0) return

    await this.prisma.authSession.updateMany({
      where: {
        id: { in: [...sessionIds] },
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    })

    for (const sessionId of sessionIds) {
      this.clearRotationState(sessionId)
    }
  }

  /** 获取当前登录用户 */
  async getMe(authUser: AuthUserContext): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: authUser.userId },
      select: userProfileSelect,
    })

    if (!user) {
      throw this.tokenInvalid('用户不存在或已被删除')
    }

    return toAuthUser(user, toEffectiveRoles(user), toPermissionCodes(user))
  }

  private async revokeSession(sessionId: string): Promise<void> {
    await this.prisma.authSession.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    })

    this.clearRotationState(sessionId)
  }

  private buildSessionResult(
    sessionId: string,
    userId: string,
    refreshToken: string,
    user: UserWithRoles,
  ): SessionResult {
    return {
      accessToken: this.tokenService.signAccessToken(userId, sessionId),
      refreshToken,
      user: toAuthUser(user, toEffectiveRoles(user), toPermissionCodes(user)),
    }
  }

  private getRecentRotation(previousHash: string): RecentRotation | null {
    const cached = this.recentRotations.get(previousHash)

    if (!cached) return null

    if (Date.now() - cached.completedAt > this.rotationGraceMs) {
      this.recentRotations.delete(previousHash)
      return null
    }

    return cached
  }

  private rememberRotation(previousHash: string, rotation: RecentRotation): void {
    this.pruneRecentRotations()
    this.recentRotations.set(previousHash, rotation)
  }

  private pruneRecentRotations(): void {
    const now = Date.now()

    for (const [hash, rotation] of this.recentRotations) {
      if (now - rotation.completedAt > this.rotationGraceMs) {
        this.recentRotations.delete(hash)
      }
    }
  }

  private clearRotationState(sessionId: string): void {
    this.pendingRotations.delete(sessionId)

    for (const [hash, rotation] of this.recentRotations) {
      if (rotation.sessionId === sessionId) {
        this.recentRotations.delete(hash)
      }
    }
  }

  private refreshInvalid(message: string): UnauthorizedException {
    return new UnauthorizedException({ code: 40102, data: null, message })
  }

  private tokenInvalid(message: string): UnauthorizedException {
    return new UnauthorizedException({ code: 40101, data: null, message })
  }
}
