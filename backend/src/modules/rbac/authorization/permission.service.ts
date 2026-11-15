import { Injectable } from '@nestjs/common'

import type { DataScope } from '../../../../generated/prisma/client.js'
import { PrismaService } from '../../../prisma/prisma.service.js'
import { CoordinatorEligibilityService } from '../../profiles/coordinator-eligibility.service.js'

/** 一条仍然有效的角色分配（已过滤撤销、过期、停用角色） */
export interface EffectiveRoleAssignment {
  assignmentId: string
  userId?: string
  roleId: string
  roleCode: string
  roleName: string
  dataScope: DataScope
  scopeOrgUnitId: string | null
  validFrom: Date
  validUntil: Date | null
}

const EFFECTIVE_ASSIGNMENT_SELECT = {
  id: true,
  userId: true,
  roleId: true,
  scopeOrgUnitId: true,
  validFrom: true,
  validUntil: true,
  role: {
    select: {
      code: true,
      name: true,
      dataScope: true,
      status: true,
    },
  },
} as const

/**
 * 功能权限解析
 *
 * 设计要点：
 * 1. 角色永远从数据库读取，JWT 不携带角色与数据范围。
 * 2. 有效分配 = 未撤销 + 已生效 + 未过期 + 角色启用。
 * 3. 权限与数据范围成对返回：调用方拿到的是「哪些角色分配授予了该权限」，
 *    而不是「用户拥有哪些权限」的扁平集合，避免把不同角色的范围错误合并。
 * 4. 不做进程内权限缓存，避免角色撤销后出现授权残留；如需缓存必须配套失效。
 */
@Injectable()
export class PermissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly coordinatorEligibility: CoordinatorEligibilityService,
  ) {}

  /** 当前用户全部有效角色分配 */
  async findEffectiveAssignments(
    userId: string,
    now = new Date(),
  ): Promise<EffectiveRoleAssignment[]> {
    return (await this.resolveRoleContext(userId, now)).assignments
  }

  /**
   * 有效角色上下文：分配列表 + 最近到期时间
   *
   * 最近到期时间用于限制菜单缓存 TTL，避免资格自然到期后菜单入口仍然可见。
   */
  async resolveRoleContext(
    userId: string,
    now = new Date(),
  ): Promise<{ assignments: EffectiveRoleAssignment[]; nextExpiry: Date | null }> {
    // 用户状态是有效授权的前置条件，不能只依赖 AccessTokenGuard
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { status: true, deletedAt: true },
    })

    if (!user || user.deletedAt || user.status !== 'ACTIVE') {
      return { assignments: [], nextExpiry: null }
    }

    const rows = await this.prisma.userRole.findMany({
      where: {
        userId,
        validFrom: { lte: now },
        OR: [{ validUntil: null }, { validUntil: { gt: now } }],
        role: { status: 'ACTIVE' },
      },
      select: EFFECTIVE_ASSIGNMENT_SELECT,
      orderBy: { createdAt: 'asc' },
    })

    const assignments = rows.map((row) => ({
      assignmentId: row.id,
      userId: row.userId,
      roleId: row.roleId,
      roleCode: row.role.code,
      roleName: row.role.name,
      dataScope: row.role.dataScope,
      scopeOrgUnitId: row.scopeOrgUnitId,
      validFrom: row.validFrom,
      validUntil: row.validUntil,
    }))

    // CLASS_COORDINATOR 需要实时资格复核，其他角色保持原有判断
    return this.coordinatorEligibility.filterAssignments(userId, assignments)
  }

  /**
   * 授予指定权限的有效角色分配
   *
   * 返回空数组表示无权限。数据范围由调用方按每条分配分别计算后再求并集。
   */
  async findPermissionAssignments(
    userId: string,
    permissionCode: string,
    now = new Date(),
  ): Promise<EffectiveRoleAssignment[]> {
    const assignments = await this.findEffectiveAssignments(userId, now)

    if (assignments.length === 0) return []

    const granted = await this.prisma.rolePermission.findMany({
      where: {
        roleId: { in: [...new Set(assignments.map((item) => item.roleId))] },
        permission: { code: permissionCode },
      },
      select: { roleId: true },
    })

    const grantedRoleIds = new Set(granted.map((item) => item.roleId))

    return assignments.filter((item) => grantedRoleIds.has(item.roleId))
  }

  /** 是否拥有某个功能权限 */
  async hasPermission(userId: string, permissionCode: string): Promise<boolean> {
    const assignments = await this.findPermissionAssignments(userId, permissionCode)

    return assignments.length > 0
  }

  /** 当前用户拥有的全部功能权限编码（用于 /auth/me 与调试，不参与数据范围计算） */
  async getPermissionCodes(userId: string): Promise<string[]> {
    const assignments = await this.findEffectiveAssignments(userId)

    if (assignments.length === 0) return []

    const rows = await this.prisma.rolePermission.findMany({
      where: {
        roleId: { in: [...new Set(assignments.map((item) => item.roleId))] },
      },
      select: { permission: { select: { code: true } } },
    })

    return [...new Set(rows.map((row) => row.permission.code))].toSorted()
  }
}
