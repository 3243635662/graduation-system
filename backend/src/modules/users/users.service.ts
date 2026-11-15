import { PermissionCode } from '@graduation/shared'
import { ForbiddenException, Injectable } from '@nestjs/common'

import type { Prisma } from '../../../generated/prisma/client.js'
import { paginate } from '../../common/utils/pagination.util.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { CoordinatorEligibilityService } from '../profiles/coordinator-eligibility.service.js'
import {
  OrganizationScopeService,
  type OrganizationScope,
} from '../rbac/authorization/organization-scope.service.js'
import { PermissionService } from '../rbac/authorization/permission.service.js'
import { OrganizationService } from '../rbac/organizations/organization.service.js'
import type { UserListQuery } from './users.schema.js'

export interface UserRoleSummary {
  id: string
  code: string
  name: string
  scopeOrgUnitId: string | null
  scopeOrgUnitName: string | null
  scopeOrgUnitType: string | null
  validFrom: Date
  validUntil: Date | null
  revokedAt: Date | null
  revocationReason: string | null
  isEffective: boolean
}

export interface UserListItem {
  id: string
  displayName: string
  email: string
  status: string
  lastLoginAt: Date | null
  createdAt: Date
  roles: UserRoleSummary[]
  studentProfile: {
    id: string
    studentNo: string
    name: string
    classId: string
    className: string
    enrollmentStatus: string
  } | null
  teacherProfile: {
    id: string
    teacherNo: string
    departmentId: string
    departmentName: string
    employmentStatus: string
  } | null
}

const USER_SELECT = {
  id: true,
  displayName: true,
  email: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
  deletedAt: true,
  studentProfile: {
    select: {
      id: true,
      studentNo: true,
      name: true,
      classId: true,
      enrollmentStatus: true,
      class: { select: { id: true, name: true } },
    },
  },
  teacherProfile: {
    select: {
      id: true,
      teacherNo: true,
      departmentId: true,
      employmentStatus: true,
      department: { select: { id: true, name: true } },
    },
  },
} as const

const ROLE_SELECT = {
  id: true,
  userId: true,
  scopeOrgUnitId: true,
  validFrom: true,
  validUntil: true,
  revokedAt: true,
  revocationReason: true,
  role: {
    select: { code: true, name: true, dataScope: true, status: true },
  },
  scopeOrgUnit: { select: { name: true, type: true } },
} as const

function scopeSet(scope: OrganizationScope): Set<string> | 'ALL' | 'NONE' {
  if (scope.kind === 'ALL') return 'ALL'
  if (scope.kind === 'NONE') return 'NONE'

  return new Set(scope.orgUnitIds)
}

function withinScope(scope: Set<string> | 'ALL' | 'NONE', id: string | null): boolean {
  if (scope === 'ALL') return true
  if (scope === 'NONE' || !id) return false

  return scope.has(id)
}

/**
 * 用户账号查询
 *
 * 安全边界：
 * 1. 账号可见性由「学生档案班级 / 教师档案院系 / 有效管理角色 / 有效辅导员分配」决定；
 * 2. 每个关联档案单独授权，不因账号可见就泄露其他组织的数据；
 * 3. 角色摘要按调用者的角色分配读取范围再次过滤；
 * 4. 所有过滤条件在 Prisma where 阶段完成。
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopeService: OrganizationScopeService,
    private readonly permissionService: PermissionService,
    private readonly organizationService: OrganizationService,
    private readonly eligibility: CoordinatorEligibilityService,
  ) {}

  async list(actorId: string, query: UserListQuery) {
    const orgIds = await this.resolveUserOrgIds(actorId, query.orgUnitId)
    const roleContext = await this.resolveRoleVisibility(actorId)
    const studentScope = scopeSet(
      await this.scopeService.resolve(actorId, PermissionCode.STUDENT_PROFILE_READ),
    )
    const teacherScope = scopeSet(
      await this.scopeService.resolve(actorId, PermissionCode.TEACHER_PROFILE_READ),
    )

    const qualifiedCoordinators = await this.findQualifiedCoordinators(orgIds)

    const where = this.buildWhere(query, orgIds, qualifiedCoordinators.userIds, roleContext)

    const result = await paginate(
      query,
      (args) =>
        this.prisma.user.findMany({
          where,
          select: USER_SELECT,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          ...args,
        }),
      () => this.prisma.user.count({ where }),
    )

    const roleRows = await this.loadRoleRows(result.list.map((item) => item.id))

    return {
      total: result.total,
      list: result.list.map((item) =>
        this.toListItem(item, roleRows, {
          studentScope,
          teacherScope,
          roleContext,
          qualifiedCoordinatorKeys: qualifiedCoordinators.keys,
          userOrgIds: orgIds,
        }),
      ),
    }
  }

  async findOne(actorId: string, userId: string): Promise<UserListItem> {
    const orgIds = await this.resolveUserOrgIds(actorId)
    const roleContext = await this.resolveRoleVisibility(actorId)
    const studentScope = scopeSet(
      await this.scopeService.resolve(actorId, PermissionCode.STUDENT_PROFILE_READ),
    )
    const teacherScope = scopeSet(
      await this.scopeService.resolve(actorId, PermissionCode.TEACHER_PROFILE_READ),
    )
    const qualifiedCoordinators = await this.findQualifiedCoordinators(orgIds)

    const user = await this.prisma.user.findFirst({
      where: {
        AND: [
          { id: userId },
          { deletedAt: null },
          this.visibilityWhere(orgIds, qualifiedCoordinators.userIds),
        ],
      },
      select: USER_SELECT,
    })

    if (!user) {
      throw new ForbiddenException({
        code: 40300,
        data: null,
        message: '该用户不在当前访问范围内',
      })
    }

    const roleRows = await this.loadRoleRows([user.id])

    return this.toListItem(user, roleRows, {
      studentScope,
      teacherScope,
      roleContext,
      qualifiedCoordinatorKeys: qualifiedCoordinators.keys,
      userOrgIds: orgIds,
    })
  }

  /** 计算当前调用者的账号可见组织集合；ALL / NONE 均不允许普通用户列表 */
  private async resolveUserOrgIds(actorId: string, requestedOrgUnitId?: string): Promise<string[]> {
    const scope = await this.scopeService.resolve(actorId, PermissionCode.USER_READ)

    if (scope.kind !== 'SUBTREE') {
      throw new ForbiddenException({
        code: 40300,
        data: null,
        message: '当前账号没有可用的用户管理组织范围',
      })
    }

    let orgIds = scope.orgUnitIds

    if (requestedOrgUnitId) {
      await this.scopeService.assertOrgUnitAccess(
        actorId,
        PermissionCode.USER_READ,
        requestedOrgUnitId,
      )

      const requestedSubtree = await this.organizationService.getSubtreeIds(requestedOrgUnitId)
      const allowed = new Set(orgIds)

      orgIds = requestedSubtree.filter((id) => allowed.has(id))

      if (orgIds.length === 0) {
        throw new ForbiddenException({
          code: 40300,
          data: null,
          message: '目标组织不在当前访问范围内',
        })
      }
    }

    return orgIds
  }

  /**
   * 批量计算通过 CLASS_COORDINATOR 关系可见的账号
   *
   * 先一次性取出范围内的有效协管员分配，再交给资格服务批量过滤，
   * 不在用户列表上做逐用户查询。
   */
  private async findQualifiedCoordinators(
    orgIds: string[],
  ): Promise<{ keys: Set<string>; userIds: Set<string> }> {
    if (orgIds.length === 0) return { keys: new Set(), userIds: new Set() }

    const now = new Date()

    const rows = await this.prisma.userRole.findMany({
      where: {
        scopeOrgUnitId: { in: orgIds },
        revokedAt: null,
        validFrom: { lte: now },
        OR: [{ validUntil: null }, { validUntil: { gt: now } }],
        role: { code: 'CLASS_COORDINATOR', status: 'ACTIVE' },
        user: { status: 'ACTIVE', deletedAt: null },
      },
      select: { userId: true, scopeOrgUnitId: true },
    })

    const assignments = rows
      .filter((row): row is { userId: string; scopeOrgUnitId: string } =>
        Boolean(row.scopeOrgUnitId),
      )
      .map((row) => ({ userId: row.userId, classId: row.scopeOrgUnitId }))

    const keys = await this.eligibility.filterQualifiedUserIds(assignments)
    const userIds = new Set([...keys].map((key) => key.split(':')[0] ?? ''))

    return { keys, userIds }
  }

  /** 角色摘要的可见范围：读取权限对应的组织范围 + 是否允许无组织角色 */
  private async resolveRoleVisibility(actorId: string) {
    const scope = await this.scopeService.resolve(actorId, PermissionCode.ROLE_ASSIGNMENT_READ)

    const assignments = await this.permissionService.findPermissionAssignments(
      actorId,
      PermissionCode.ROLE_ASSIGNMENT_READ,
    )

    return {
      scope: scopeSet(scope),
      canSeeUnscopedRoles: assignments.some(
        (item) => item.dataScope === 'SCHOOL' || item.dataScope === 'GLOBAL',
      ),
    }
  }

  private visibilityWhere(
    orgIds: string[],
    qualifiedCoordinatorUserIds: Set<string>,
  ): Prisma.UserWhereInput {
    const now = new Date()
    const coordinatorIds = [...qualifiedCoordinatorUserIds]

    return {
      OR: [
        { studentProfile: { classId: { in: orgIds } } },
        { teacherProfile: { departmentId: { in: orgIds } } },
        {
          userRoles: {
            some: {
              scopeOrgUnitId: { in: orgIds },
              revokedAt: null,
              validFrom: { lte: now },
              OR: [{ validUntil: null }, { validUntil: { gt: now } }],
              role: { status: 'ACTIVE', code: { not: 'CLASS_COORDINATOR' } },
            },
          },
        },
        {
          counselorAssignments: {
            some: {
              classId: { in: orgIds },
              revokedAt: null,
              validFrom: { lte: now },
              OR: [{ validUntil: null }, { validUntil: { gt: now } }],
            },
          },
        },
        ...(coordinatorIds.length > 0 ? [{ id: { in: coordinatorIds } }] : []),
      ],
    }
  }

  private buildWhere(
    query: UserListQuery,
    orgIds: string[],
    qualifiedCoordinatorUserIds: Set<string>,
    roleContext: { scope: Set<string> | 'ALL' | 'NONE'; canSeeUnscopedRoles: boolean },
  ): Prisma.UserWhereInput {
    const now = new Date()
    const and: Prisma.UserWhereInput[] = [
      { deletedAt: null },
      { status: query.status ?? 'ACTIVE' },
      this.visibilityWhere(orgIds, qualifiedCoordinatorUserIds),
    ]

    if (query.keyword) {
      and.push({
        OR: [{ displayName: { contains: query.keyword } }, { email: { contains: query.keyword } }],
      })
    }

    if (query.roleCode === 'CLASS_COORDINATOR') {
      and.push({ id: { in: [...qualifiedCoordinatorUserIds] } })
    } else if (query.roleCode) {
      const scopeConditions: Prisma.UserRoleWhereInput[] =
        roleContext.scope === 'ALL'
          ? []
          : [
              {
                OR: [
                  { scopeOrgUnitId: { in: [...(roleContext.scope as Set<string>)] } },
                  ...(roleContext.canSeeUnscopedRoles ? [{ scopeOrgUnitId: null }] : []),
                ],
              },
            ]

      const scopedFilter: Prisma.UserRoleWhereInput = {
        role: { code: query.roleCode, status: 'ACTIVE' },
        revokedAt: null,
        validFrom: { lte: now },
        OR: [{ validUntil: null }, { validUntil: { gt: now } }],
        ...(scopeConditions.length > 0 ? { AND: scopeConditions } : {}),
      }

      and.push({ userRoles: { some: scopedFilter } })
    }

    return { AND: and }
  }

  private async loadRoleRows(userIds: string[]) {
    if (userIds.length === 0) return []

    return this.prisma.userRole.findMany({
      where: { userId: { in: userIds } },
      select: ROLE_SELECT,
      orderBy: [{ createdAt: 'desc' }],
    })
  }

  private toListItem(
    user: Prisma.UserGetPayload<{ select: typeof USER_SELECT }>,
    roleRows: Array<{
      id: string
      userId: string
      scopeOrgUnitId: string | null
      validFrom: Date
      validUntil: Date | null
      revokedAt: Date | null
      revocationReason: string | null
      role: { code: string; name: string; dataScope: string; status: string }
      scopeOrgUnit: { name: string; type: string } | null
    }>,
    context: {
      studentScope: Set<string> | 'ALL' | 'NONE'
      teacherScope: Set<string> | 'ALL' | 'NONE'
      roleContext: { scope: Set<string> | 'ALL' | 'NONE'; canSeeUnscopedRoles: boolean }
      qualifiedCoordinatorKeys: Set<string>
      userOrgIds: string[]
    },
  ): UserListItem {
    const now = new Date()

    const studentProfile = user.studentProfile
      ? withinScope(context.studentScope, user.studentProfile.classId) &&
        context.userOrgIds.includes(user.studentProfile.classId)
        ? {
            id: user.studentProfile.id,
            studentNo: user.studentProfile.studentNo,
            name: user.studentProfile.name,
            classId: user.studentProfile.classId,
            className: user.studentProfile.class.name,
            enrollmentStatus: user.studentProfile.enrollmentStatus,
          }
        : null
      : null

    const teacherProfile = user.teacherProfile
      ? withinScope(context.teacherScope, user.teacherProfile.departmentId) &&
        context.userOrgIds.includes(user.teacherProfile.departmentId)
        ? {
            id: user.teacherProfile.id,
            teacherNo: user.teacherProfile.teacherNo,
            departmentId: user.teacherProfile.departmentId,
            departmentName: user.teacherProfile.department.name,
            employmentStatus: user.teacherProfile.employmentStatus,
          }
        : null
      : null

    const roles = roleRows
      .filter((row) => row.userId === user.id)
      .filter((row) => {
        if (row.scopeOrgUnitId) {
          return withinScope(context.roleContext.scope, row.scopeOrgUnitId)
        }

        // 无组织范围角色：学生/教师角色随其档案可见性展示，其余管理角色仅学校级可见
        if (row.role.code === 'STUDENT') return Boolean(studentProfile)
        if (row.role.code === 'TEACHER') return Boolean(teacherProfile)

        return context.roleContext.canSeeUnscopedRoles
      })
      .map((row) => {
        const windowEffective =
          row.revokedAt === null &&
          row.validFrom.getTime() <= now.getTime() &&
          (!row.validUntil || row.validUntil.getTime() > now.getTime()) &&
          row.role.status === 'ACTIVE'

        const scopeActive = row.scopeOrgUnitId
          ? context.userOrgIds.includes(row.scopeOrgUnitId)
          : true

        const qualificationEffective =
          row.role.code === 'CLASS_COORDINATOR' && row.scopeOrgUnitId
            ? context.qualifiedCoordinatorKeys.has(`${user.id}:${row.scopeOrgUnitId}`)
            : true

        return {
          id: row.id,
          code: row.role.code,
          name: row.role.name,
          scopeOrgUnitId: row.scopeOrgUnitId,
          scopeOrgUnitName: row.scopeOrgUnit?.name ?? null,
          scopeOrgUnitType: row.scopeOrgUnit?.type ?? null,
          validFrom: row.validFrom,
          validUntil: row.validUntil,
          revokedAt: row.revokedAt,
          revocationReason: row.revocationReason,
          isEffective: windowEffective && scopeActive && qualificationEffective,
        }
      })

    return {
      id: user.id,
      displayName: user.displayName,
      email: user.email,
      status: user.status,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      roles,
      studentProfile,
      teacherProfile,
    }
  }
}
