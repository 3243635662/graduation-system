import type { AuthUser, RoleSummary } from '@graduation/shared'
import {
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
  email: string
  displayName: string
  status: 'ACTIVE' | 'DISABLED' | 'LOCKED'
}

/** 用户 + 角色的查询结构 */
type UserWithRoles = UserProfileRecord & {
  userRoles: Array<{ role: RoleSummary }>
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

function toAuthUser(user: UserProfileRecord, roles: RoleSummary[]): AuthUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    status: user.status,
    roles,
  }
}

const userProfileSelect = {
  id: true,
  email: true,
  displayName: true,
  status: true,
  userRoles: {
    select: {
      role: {
        select: {
          id: true,
          code: true,
          name: true,
        },
      },
    },
  },
} as const

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
          displayName: input.displayName,
          status: 'ACTIVE',
        },
        select: {
          id: true,
          email: true,
          displayName: true,
          status: true,
        },
      })

      await tx.userRole.create({
        data: {
          userId: user.id,
          roleId: studentRole.id,
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
      user: toAuthUser(result.user, [result.role]),
    }
  }

  /**
   * 登录
   *
   * 用户不存在与密码错误返回同一错误信息，避免邮箱枚举。
   */
  async login(input: LoginInput, meta: SessionMeta): Promise<SessionResult> {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: {
        ...userProfileSelect,
        passwordHash: true,
      },
    })

    const passwordHash = user?.passwordHash ?? (await getDummyPasswordHash())
    const passwordValid = await verifyPassword(passwordHash, input.password)

    if (!user || !passwordValid) {
      throw new UnauthorizedException('邮箱或密码错误')
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
      user: toAuthUser(
        user,
        user.userRoles.map((item) => item.role),
      ),
    }
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

    return toAuthUser(
      user,
      user.userRoles.map((item) => item.role),
    )
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
      user: toAuthUser(
        user,
        user.userRoles.map((item) => item.role),
      ),
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
