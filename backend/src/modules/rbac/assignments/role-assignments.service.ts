import { PRESET_ROLES, PermissionCode, RoleCode } from '@graduation/shared'
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'

import type { DataScope, OrganizationType } from '../../../../generated/prisma/client.js'
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

const ASSIGNMENT_SELECT = {
  id: true,
  userId: true,
  scopeOrgUnitId: true,
  validFrom: true,
  validUntil: true,
  revokedAt: true,
  assignedById: true,
  revokedById: true,
  revocationReason: true,
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

export interface RoleAssignmentItem {
  id: string
  userId: string
  roleCode: string
  roleName: string
  scopeOrgUnitId: string | null
  scopeOrgUnitName: string | null
  scopeOrgUnitType: string | null
  validFrom: Date
  validUntil: Date | null
  revokedAt: Date | null
  assignedById: string | null
  revokedById: string | null
  revocationReason: 'MANUAL' | 'QUALIFICATION_LOST' | null
  isEffective: boolean
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

function isEffective(row: {
  validFrom: Date
  validUntil: Date | null
  revokedAt: Date | null
}): boolean {
  const now = Date.now()

  return (
    row.revokedAt === null &&
    row.validFrom.getTime() <= now &&
    (row.validUntil === null || row.validUntil.getTime() > now)
  )
}

/**
 * 角色分配服务
 *
 * 安全边界：
 * 1. Controller 的 PermissionsGuard 只保证「拥有角色分配权限」。
 * 2. 本服务负责「能分配哪些角色」「能操作哪个组织范围」「目标用户是否存在」。
 * 3. 所有写入与撤销都会提升菜单缓存 generation（事务提交后）。
 * 4. 撤销只写 revokedAt / revokedById，绝不删除历史记录。
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

  /** 查询某个用户的角色分配（默认只返回仍有效的分配） */
  async listForUser(
    actorId: string,
    targetUserId: string,
    includeRevoked = false,
  ): Promise<RoleAssignmentItem[]> {
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, deletedAt: true },
    })

    if (!target || target.deletedAt) {
      throw new NotFoundException('用户不存在')
    }

    const capability = await this.loadCapability(actorId, PermissionCode.ROLE_ASSIGNMENT_READ)

    const rows = await this.prisma.userRole.findMany({
      where: {
        userId: targetUserId,
        ...(includeRevoked ? {} : { revokedAt: null }),
      },
      select: ASSIGNMENT_SELECT,
      orderBy: { createdAt: 'desc' },
    })

    const scope = await this.scopeService.resolve(actorId, PermissionCode.ROLE_ASSIGNMENT_READ)

    return rows
      .filter((row) =>
        this.isWithinAssignmentScope(capability, scope, row.role.code, row.scopeOrgUnitId),
      )
      .map((row) => ({
        id: row.id,
        userId: row.userId,
        roleCode: row.role.code,
        roleName: row.role.name,
        scopeOrgUnitId: row.scopeOrgUnitId,
        scopeOrgUnitName: row.scopeOrgUnit?.name ?? null,
        scopeOrgUnitType: row.scopeOrgUnit?.type ?? null,
        validFrom: row.validFrom,
        validUntil: row.validUntil,
        revokedAt: row.revokedAt,
        assignedById: row.assignedById,
        revokedById: row.revokedById,
        revocationReason: row.revocationReason,
        isEffective: isEffective(row) && row.role.status === 'ACTIVE',
      }))
  }

  /** 分配角色：矩阵校验 + 组织范围校验 + 事务内重复检查 */
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

    const created = await this.menuCacheInvalidator.commitThenInvalidate('user-role.assign', () =>
      this.prisma.$transaction(async (tx) => {
        const now = new Date()

        // 同一用户 + 同一角色 + 同一组织范围，不允许存在两条同时有效的分配
        const duplicated = await tx.userRole.findFirst({
          where: {
            userId: input.userId,
            roleId: role.id,
            scopeOrgUnitId,
            revokedAt: null,
            validFrom: { lte: now },
            OR: [{ validUntil: null }, { validUntil: { gt: now } }],
          },
          select: { id: true },
        })

        if (duplicated) {
          throw new ConflictException('该用户在此范围内已拥有该角色的有效分配')
        }

        return tx.userRole.create({
          data: {
            userId: input.userId,
            roleId: role.id,
            scopeOrgUnitId,
            assignedById: actorId,
            createdById: actorId,
            validFrom: now,
            validUntil,
          },
          select: ASSIGNMENT_SELECT,
        })
      }),
    )

    return {
      id: created.id,
      userId: created.userId,
      roleCode: created.role.code,
      roleName: created.role.name,
      scopeOrgUnitId: created.scopeOrgUnitId,
      scopeOrgUnitName: created.scopeOrgUnit?.name ?? null,
      scopeOrgUnitType: created.scopeOrgUnit?.type ?? null,
      validFrom: created.validFrom,
      validUntil: created.validUntil,
      revokedAt: created.revokedAt,
      assignedById: created.assignedById,
      revokedById: created.revokedById,
      revocationReason: created.revocationReason,
      isEffective: true,
    }
  }

  /** 撤销角色分配（软撤销，保留历史） */
  async revoke(actorId: string, assignmentId: string): Promise<RoleAssignmentItem> {
    const assignment = await this.prisma.userRole.findUnique({
      where: { id: assignmentId },
      select: { ...ASSIGNMENT_SELECT, userId: true },
    })

    if (!assignment) {
      throw new NotFoundException('角色分配记录不存在')
    }

    if (assignment.userId === actorId) {
      throw forbidden('不能撤销自己的角色分配，请联系上级管理员')
    }

    if (assignment.revokedAt) {
      throw new ConflictException('该角色分配已被撤销')
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

    const result = await this.menuCacheInvalidator.commitThenInvalidate('user-role.revoke', () =>
      this.prisma.userRole.updateMany({
        where: { id: assignmentId, revokedAt: null },
        data: {
          revokedAt,
          revokedById: actorId,
          revocationReason: 'MANUAL',
        },
      }),
    )

    if (result.count !== 1) {
      throw new ConflictException('该角色分配已被撤销')
    }

    return {
      id: assignment.id,
      userId: assignment.userId,
      roleCode: assignment.role.code,
      roleName: assignment.role.name,
      scopeOrgUnitId: assignment.scopeOrgUnitId,
      scopeOrgUnitName: assignment.scopeOrgUnit?.name ?? null,
      scopeOrgUnitType: assignment.scopeOrgUnit?.type ?? null,
      validFrom: assignment.validFrom,
      validUntil: assignment.validUntil,
      revokedAt,
      assignedById: assignment.assignedById,
      revokedById: actorId,
      revocationReason: 'MANUAL',
      isEffective: false,
    }
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
