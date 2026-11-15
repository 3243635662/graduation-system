import { PRESET_ROLES, PermissionCode, RoleCode } from '@graduation/shared'
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'

import type {
  DataScope,
  OrganizationType,
  UserRoleRevocationReason,
} from '../../../../generated/prisma/client.js'
import { PrismaService } from '../../../prisma/prisma.service.js'
import { MenuCacheInvalidatorService } from '../../menus/menu-cache-invalidator.service.js'
import { CoordinatorEligibilityService } from '../../profiles/coordinator-eligibility.service.js'
import { OrganizationScopeService } from '../authorization/organization-scope.service.js'
import {
  PermissionService,
  type EffectiveRoleAssignment,
} from '../authorization/permission.service.js'
import { OrganizationService } from '../organizations/organization.service.js'
import {
  ROLE_SCOPE_TYPE,
  assignableRolesFor,
  canAssignRole,
  requiresSchoolLevel,
} from './role-assignment.policy.js'
import type { AssignRoleBody } from './role-assignment.schema.js'

/** 不绑定组织节点的角色统一使用该范围键 */
const GLOBAL_SCOPE_KEY = 'GLOBAL'

/** 当前授权表字段（该表只保存「仍然存在」的授权，撤销即删除） */
const ASSIGNMENT_SELECT = {
  id: true,
  userId: true,
  roleId: true,
  scopeOrgUnitId: true,
  scopeKey: true,
  assignedById: true,
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
  scopeOrgUnit: {
    select: {
      name: true,
      type: true,
    },
  },
} as const

/** 不可变历史表字段（只追加，不更新） */
const HISTORY_SELECT = {
  id: true,
  userRoleId: true,
  userId: true,
  roleId: true,
  roleCode: true,
  scopeOrgUnitId: true,
  scopeKey: true,
  assignedById: true,
  validFrom: true,
  validUntil: true,
  revokedAt: true,
  revokedById: true,
  revocationReason: true,
  note: true,
  role: {
    select: {
      name: true,
    },
  },
  scopeOrgUnit: {
    select: {
      name: true,
      type: true,
    },
  },
  revokedBy: {
    select: {
      realName: true,
    },
  },
} as const

type AssignmentRow = {
  id: string
  userId: string
  roleId: string
  scopeOrgUnitId: string | null
  scopeKey: string
  assignedById: string | null
  validFrom: Date
  validUntil: Date | null
  role: { code: string; name: string; dataScope: DataScope; status: 'ACTIVE' | 'DISABLED' }
  scopeOrgUnit: { name: string; type: OrganizationType } | null
}

type HistoryRow = {
  id: string
  userRoleId: string
  userId: string
  roleId: string
  roleCode: string
  scopeKey: string
  scopeOrgUnitId: string | null
  assignedById: string | null
  validFrom: Date
  validUntil: Date | null
  revokedAt: Date
  revokedById: string | null
  revocationReason: UserRoleRevocationReason
  note: string | null
  role: { name: string }
  scopeOrgUnit: { name: string; type: OrganizationType } | null
  revokedBy: { realName: string } | null
}

export interface RoleAssignmentItem {
  id: string
  userId: string
  roleCode: string
  roleName: string
  scopeOrgUnitId: string | null
  /** 规范化范围键：'GLOBAL' 或组织节点 ID（与 scopeOrgUnitId 保持一致） */
  scopeKey: string
  scopeOrgUnitName: string | null
  scopeOrgUnitType: string | null
  validFrom: Date
  validUntil: Date | null
  assignedById: string | null
  isEffective: boolean
}

export interface RoleAssignmentHistoryItem {
  id: string
  /** 被撤销的那条当前授权行的 ID */
  userRoleId: string
  userId: string
  roleId: string
  roleCode: string
  roleName: string
  scopeOrgUnitId: string | null
  scopeKey: string
  scopeOrgUnitName: string | null
  scopeOrgUnitType: string | null
  assignedById: string | null
  validFrom: Date
  validUntil: Date | null
  revokedAt: Date
  revokedById: string | null
  /** 撤销人真名，撤销人被删除时为 null */
  revokedByName: string | null
  revocationReason: UserRoleRevocationReason
  note: string | null
}

export interface AssignableRoleItem {
  code: RoleCode
  name: string
  dataScope: DataScope
  scopeType: OrganizationType | null
  requiresSchoolLevel: boolean
}

interface ActorCapability {
  assignments: EffectiveRoleAssignment[]
  roleCodes: string[]
  /** 是否具备学校级（GLOBAL / SCHOOL）范围，用于分配不绑定组织的角色 */
  schoolLevel: boolean
}

function forbidden(message: string): ForbiddenException {
  return new ForbiddenException({ code: 40300, data: null, message })
}

/** Prisma 唯一约束冲突（P2002） */
function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  )
}

/** 范围键规范化：组织角色取组织节点 ID，其余统一 'GLOBAL' */
function toScopeKey(scopeOrgUnitId: string | null): string {
  return scopeOrgUnitId ?? GLOBAL_SCOPE_KEY
}

/** 当前授权表中该行是否处于生效时间窗内（撤销已由「删除行」表达） */
function isEffective(row: { validFrom: Date; validUntil: Date | null }): boolean {
  const now = Date.now()

  return (
    row.validFrom.getTime() <= now && (row.validUntil === null || row.validUntil.getTime() > now)
  )
}

function toAssignmentItem(row: AssignmentRow): RoleAssignmentItem {
  return {
    id: row.id,
    userId: row.userId,
    roleCode: row.role.code,
    roleName: row.role.name,
    scopeOrgUnitId: row.scopeOrgUnitId,
    scopeKey: row.scopeKey,
    scopeOrgUnitName: row.scopeOrgUnit?.name ?? null,
    scopeOrgUnitType: row.scopeOrgUnit?.type ?? null,
    validFrom: row.validFrom,
    validUntil: row.validUntil,
    assignedById: row.assignedById,
    isEffective: isEffective(row) && row.role.status === 'ACTIVE',
  }
}

function toHistoryItem(row: HistoryRow): RoleAssignmentHistoryItem {
  return {
    id: row.id,
    userRoleId: row.userRoleId,
    userId: row.userId,
    roleId: row.roleId,
    roleCode: row.roleCode,
    roleName: row.role.name,
    scopeOrgUnitId: row.scopeOrgUnitId,
    scopeKey: row.scopeKey,
    scopeOrgUnitName: row.scopeOrgUnit?.name ?? null,
    scopeOrgUnitType: row.scopeOrgUnit?.type ?? null,
    assignedById: row.assignedById,
    validFrom: row.validFrom,
    validUntil: row.validUntil,
    revokedAt: row.revokedAt,
    revokedById: row.revokedById,
    revokedByName: row.revokedBy?.realName ?? null,
    revocationReason: row.revocationReason,
    note: row.note,
  }
}

/**
 * 角色分配服务
 *
 * 安全边界：
 * 1. Controller 的 PermissionsGuard 只保证「拥有角色分配权限」。
 * 2. 本服务负责「能分配哪些角色」「能操作哪个组织范围」「目标用户是否存在」。
 * 3. 所有写入与撤销都会提升菜单缓存 generation（事务提交后）。
 * 4. 当前表 user_roles 只保存仍然存在的授权；撤销先在事务内写入
 *    user_role_history 快照，再删除当前行，历史永不可变。
 */
@Injectable()
export class RoleAssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissionService: PermissionService,
    private readonly scopeService: OrganizationScopeService,
    private readonly organizationService: OrganizationService,
    private readonly menuCacheInvalidator: MenuCacheInvalidatorService,
    private readonly coordinatorEligibility: CoordinatorEligibilityService,
  ) {}

  /** 当前调用者可分配的角色模板 */
  async listAssignableRoles(actorId: string): Promise<AssignableRoleItem[]> {
    const capability = await this.loadCapability(actorId, PermissionCode.ROLE_ASSIGNMENT_READ)
    const codes = assignableRolesFor(capability.roleCodes)

    return codes
      .map((code) => {
        const definition = PRESET_ROLES.find((role) => role.code === code)

        if (!definition) return null

        return {
          code,
          name: definition.name,
          dataScope: definition.dataScope,
          scopeType: ROLE_SCOPE_TYPE[code],
          requiresSchoolLevel: requiresSchoolLevel(code),
        }
      })
      .filter((item): item is AssignableRoleItem => item !== null)
  }

  /**
   * 查询某个用户当前的授权
   *
   * user_roles 只保存仍然存在的授权行，因此不存在「已撤销」状态需要过滤；
   * 已被撤销的授权请使用 listHistory 查询。
   */
  async listForUser(actorId: string, targetUserId: string): Promise<RoleAssignmentItem[]> {
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, deletedAt: true },
    })

    if (!target || target.deletedAt) {
      throw new NotFoundException('用户不存在')
    }

    const capability = await this.loadCapability(actorId, PermissionCode.ROLE_ASSIGNMENT_READ)

    const rows = await this.prisma.userRole.findMany({
      where: { userId: targetUserId },
      select: ASSIGNMENT_SELECT,
      orderBy: { createdAt: 'desc' },
    })

    const scope = await this.scopeService.resolve(actorId, PermissionCode.ROLE_ASSIGNMENT_READ)

    return rows
      .filter((row) =>
        this.isWithinAssignmentScope(capability, scope, row.role.code, row.scopeOrgUnitId),
      )
      .map((row) => toAssignmentItem(row))
  }

  /**
   * 查询某个用户的授权历史（只读，按撤销时间倒序）
   *
   * 可见性规则与 listForUser 一致：先按组织范围过滤，再返回快照。
   */
  async listHistory(actorId: string, targetUserId: string): Promise<RoleAssignmentHistoryItem[]> {
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, deletedAt: true },
    })

    if (!target || target.deletedAt) {
      throw new NotFoundException('用户不存在')
    }

    const capability = await this.loadCapability(actorId, PermissionCode.ROLE_ASSIGNMENT_READ)

    const rows = await this.prisma.userRoleHistory.findMany({
      where: { userId: targetUserId },
      select: HISTORY_SELECT,
      orderBy: [{ revokedAt: 'desc' }, { createdAt: 'desc' }],
    })

    const scope = await this.scopeService.resolve(actorId, PermissionCode.ROLE_ASSIGNMENT_READ)

    return rows
      .filter((row) =>
        this.isWithinAssignmentScope(capability, scope, row.roleCode, row.scopeOrgUnitId),
      )
      .map((row) => toHistoryItem(row))
  }

  /** 分配角色：矩阵校验 + 组织范围校验 + 唯一键兜住重复分配 */
  async assign(actorId: string, input: AssignRoleBody): Promise<RoleAssignmentItem> {
    const capability = await this.loadCapability(actorId, PermissionCode.ROLE_ASSIGNMENT_ASSIGN)

    if (!canAssignRole(capability.roleCodes, input.roleCode)) {
      throw forbidden('不允许分配该角色')
    }

    const scopeOrgUnitId = input.scopeOrgUnitId ?? null
    await this.assertScopeAllowed(actorId, capability, input.roleCode, scopeOrgUnitId)

    const validUntil = input.validUntil ? new Date(input.validUntil) : null

    if (validUntil) {
      if (Number.isNaN(validUntil.getTime())) {
        throw new BadRequestException('角色有效期格式不正确')
      }

      if (validUntil.getTime() <= Date.now()) {
        throw new BadRequestException('角色有效期必须晚于当前时间')
      }
    }

    const target = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: { id: true, status: true, deletedAt: true },
    })

    if (!target || target.deletedAt) {
      throw new NotFoundException('用户不存在')
    }

    if (target.status !== 'ACTIVE') {
      throw new BadRequestException('目标用户已被禁用，不能分配角色')
    }

    // 协管员必须满足至少一种现实资格；该判断只能在服务端完成
    if (input.roleCode === RoleCode.CLASS_COORDINATOR && scopeOrgUnitId) {
      await this.coordinatorEligibility.assertEligible(input.userId, scopeOrgUnitId)
    }

    const role = await this.prisma.role.findUnique({
      where: { code: input.roleCode },
      select: { id: true, status: true },
    })

    if (!role || role.status !== 'ACTIVE') {
      throw new BadRequestException('角色不存在或已停用')
    }

    // 单行写入本身是原子的，重复分配完全交给 uk_user_role_scope(userId, roleId, scopeKey) 判定，
    // 不再做「先查后写」，避免并发下两次查询都通过。
    const created = await this.menuCacheInvalidator.commitThenInvalidate(
      'user-role.assign',
      async () => {
        try {
          return await this.prisma.userRole.create({
            data: {
              userId: input.userId,
              roleId: role.id,
              scopeOrgUnitId,
              scopeKey: toScopeKey(scopeOrgUnitId),
              assignedById: actorId,
              createdById: actorId,
              validFrom: new Date(),
              validUntil,
            },
            select: ASSIGNMENT_SELECT,
          })
        } catch (error) {
          if (isUniqueConstraintError(error)) {
            throw new ConflictException(
              '该用户在此范围内已存在该角色的授权，请先撤销原授权后再重新分配',
            )
          }

          throw error
        }
      },
    )

    return toAssignmentItem(created)
  }

  /**
   * 撤销角色分配
   *
   * 事务内：重读当前行 → 写入不可变历史快照 → 删除当前授权行。
   * 返回被撤销的当前授权行 ID。
   */
  async revoke(actorId: string, assignmentId: string): Promise<string> {
    const assignment = await this.prisma.userRole.findUnique({
      where: { id: assignmentId },
      select: { id: true, userId: true, scopeOrgUnitId: true, role: { select: { code: true } } },
    })

    if (!assignment) {
      throw new NotFoundException('角色分配记录不存在')
    }

    if (assignment.userId === actorId) {
      throw forbidden('不能撤销自己的角色分配，请联系上级管理员')
    }

    const capability = await this.loadCapability(actorId, PermissionCode.ROLE_ASSIGNMENT_REVOKE)

    if (!canAssignRole(capability.roleCodes, assignment.role.code as RoleCode)) {
      throw forbidden('不允许撤销该角色分配')
    }

    const scope = await this.scopeService.resolve(actorId, PermissionCode.ROLE_ASSIGNMENT_REVOKE)

    if (
      !this.isWithinAssignmentScope(
        capability,
        scope,
        assignment.role.code,
        assignment.scopeOrgUnitId,
      )
    ) {
      throw forbidden('没有管理该组织范围角色分配的权限')
    }

    const revokedAt = new Date()

    await this.menuCacheInvalidator.commitThenInvalidate('user-role.revoke', () =>
      this.prisma.$transaction(async (tx) => {
        const current = await tx.userRole.findUnique({
          where: { id: assignmentId },
          select: {
            id: true,
            userId: true,
            roleId: true,
            scopeOrgUnitId: true,
            scopeKey: true,
            assignedById: true,
            validFrom: true,
            validUntil: true,
            role: { select: { code: true } },
          },
        })

        // 并发撤销：另一个请求已经删除了该行
        if (!current) {
          throw new ConflictException('该角色分配已被撤销')
        }

        // 先写历史快照：roleCode 冗余保存，角色模板后续改名或删除也不影响历史可读性
        await tx.userRoleHistory.create({
          data: {
            userRoleId: current.id,
            userId: current.userId,
            roleId: current.roleId,
            roleCode: current.role.code,
            scopeOrgUnitId: current.scopeOrgUnitId,
            scopeKey: current.scopeKey,
            assignedById: current.assignedById,
            validFrom: current.validFrom,
            validUntil: current.validUntil,
            revokedAt,
            revokedById: actorId,
            revocationReason: 'MANUAL',
          },
        })

        // 再删除当前授权行：撤销后该用户立即失去对应权限与菜单入口
        const deleted = await tx.userRole.deleteMany({ where: { id: current.id } })

        if (deleted.count !== 1) {
          throw new ConflictException('该角色分配已被撤销')
        }
      }),
    )

    return assignmentId
  }

  /**
   * 读取调用者在指定操作上的分配能力
   *
   * 必须按具体权限分别计算：只有 assign 权限的人不能借 revoke 的授权去分配角色，
   * 反之亦然。返回的角色集合只来自真正授予该权限的角色分配。
   */
  private async loadCapability(
    actorId: string,
    permissionCode: PermissionCode,
  ): Promise<ActorCapability> {
    const assignments = await this.permissionService.findPermissionAssignments(
      actorId,
      permissionCode,
    )

    if (assignments.length === 0) {
      throw forbidden('没有角色分配权限')
    }

    return {
      assignments,
      roleCodes: [...new Set(assignments.map((item) => item.roleCode))],
      schoolLevel: assignments.some(
        (item) => item.dataScope === 'GLOBAL' || item.dataScope === 'SCHOOL',
      ),
    }
  }

  /** 校验目标角色与目标组织范围是否在调用者能力之内 */
  private async assertScopeAllowed(
    actorId: string,
    capability: ActorCapability,
    targetRole: RoleCode,
    scopeOrgUnitId: string | null,
  ): Promise<void> {
    const expectedType = ROLE_SCOPE_TYPE[targetRole]

    if (expectedType === null) {
      if (scopeOrgUnitId) {
        throw new BadRequestException('该角色不应绑定组织节点')
      }

      if (!capability.schoolLevel) {
        throw forbidden('该角色对全校生效，只有学校级管理员可以分配')
      }

      return
    }

    if (!scopeOrgUnitId) {
      throw new BadRequestException('该角色必须绑定组织节点')
    }

    const unit = await this.organizationService.findById(scopeOrgUnitId)

    if (unit.type !== expectedType) {
      throw new BadRequestException(`该角色必须绑定 ${expectedType} 类型的组织节点`)
    }

    if (unit.status !== 'ACTIVE') {
      throw new BadRequestException('目标组织节点已停用')
    }

    await this.scopeService.assertOrgUnitAccess(
      actorId,
      PermissionCode.ROLE_ASSIGNMENT_ASSIGN,
      scopeOrgUnitId,
    )
  }

  /**
   * 分配记录的可见性判定（只看组织范围，不看角色矩阵）
   *
   * 读取接口需要让管理员看到自己与下属的完整任职情况（包括高于自己的角色），
   * 因此这里只限制「能看到哪些范围的记录」。
   * 真正能否分配/撤销由 canAssignRole 在写入路径单独校验。
   */
  private isWithinAssignmentScope(
    capability: ActorCapability,
    scope: { kind: 'ALL' } | { kind: 'SUBTREE'; orgUnitIds: string[] } | { kind: 'NONE' },
    roleCode: string,
    scopeOrgUnitId: string | null,
  ): boolean {
    if (requiresSchoolLevel(roleCode as RoleCode)) {
      return scope.kind === 'ALL' || capability.schoolLevel
    }

    if (scope.kind === 'ALL') return true
    if (scope.kind === 'NONE' || !scopeOrgUnitId) return false

    return scope.orgUnitIds.includes(scopeOrgUnitId)
  }
}
