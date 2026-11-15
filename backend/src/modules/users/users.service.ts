import { PermissionCode } from '@graduation/shared'
import { ConflictException, ForbiddenException, Injectable } from '@nestjs/common'

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
import type { UpdateMyProfileBody, UpdateUserAccountBody, UserListQuery } from './users.schema.js'

export interface UserRoleSummary {
  id: string
  code: string
  name: string
  scopeOrgUnitId: string | null
  scopeOrgUnitName: string | null
  scopeOrgUnitType: string | null
  validFrom: Date
  validUntil: Date | null
  isEffective: boolean
}

export interface UserListItem {
  id: string
  realName: string
  email: string
  phone: string | null
  status: string
  lastLoginAt: Date | null
  createdAt: Date
  roles: UserRoleSummary[]
  studentProfile: {
    id: string
    studentNo: string
    /** 姓名统一取 User.realName，学生档案不再保存第二份姓名 */
    name: string
    /** 未分班学生为 null */
    classId: string | null
    className: string | null
    enrollmentStatus: string
  } | null
  teacherProfile: {
    id: string
    teacherNo: string
    /** 姓名统一取 personnelProfile.user.realName */
    realName: string
    /** 正式组织归属取 personnelProfile.primaryOrganizationUnit（可为院系/专业/学校） */
    organizationId: string
    organizationName: string
    organizationType: string
    status: string
  } | null
}

const USER_SELECT = {
  id: true,
  realName: true,
  email: true,
  phone: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
  deletedAt: true,
  studentProfile: {
    select: {
      id: true,
      studentNo: true,
      classId: true,
      enrollmentStatus: true,
      class: { select: { id: true, name: true } },
    },
  },
  // 教师身份挂在工作人员档案下：User 不再直接持有 teacherProfile 关系
  personnelProfile: {
    select: {
      primaryOrganizationUnitId: true,
      primaryOrganization: { select: { id: true, name: true, type: true } },
      teacherProfile: { select: { id: true, teacherNo: true, status: true } },
    },
  },
} as const

const ROLE_SELECT = {
  id: true,
  userId: true,
  scopeOrgUnitId: true,
  validFrom: true,
  validUntil: true,
  role: {
    select: { code: true, name: true, dataScope: true, status: true },
  },
  scopeOrgUnit: { select: { name: true, type: true } },
} as const

/** 列表/详情共用的授权上下文 */
interface ListVisibilityContext {
  studentScope: Set<string> | 'ALL' | 'NONE'
  teacherScope: Set<string> | 'ALL' | 'NONE'
  roleContext: { scope: Set<string> | 'ALL' | 'NONE'; canSeeUnscopedRoles: boolean }
  qualifiedCoordinatorKeys: Set<string>
  userOrgIds: string[]
}

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
 * 1. 账号可见性由「学生档案班级 / 工作人员档案正式组织归属 / 有效管理角色 / 有效辅导员分配」决定；
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

  /**
   * 修改本人公共资料。
   *
   * 只允许真名、手机号与头像；学号、工号、班级与正式组织归属
   * 必须通过各自的档案接口变更，避免绕过历史记录。
   */
  async updateMyProfile(userId: string, input: UpdateMyProfileBody) {
    return this.applyProfileUpdate(userId, input)
  }

  /** 管理员修改账号：先做可见性校验，再更新状态与公共资料 */
  async updateAccount(actorId: string, userId: string, input: UpdateUserAccountBody) {
    await this.findOne(actorId, userId)

    if (input.status) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { status: input.status },
      })
    }

    return this.applyProfileUpdate(userId, input)
  }

  private async applyProfileUpdate(
    userId: string,
    input: { realName?: string; phone?: string | null; avatarUrl?: string | null },
  ) {
    try {
      return await this.prisma.user.update({
        where: { id: userId },
        data: {
          ...(input.realName === undefined ? {} : { realName: input.realName.trim() }),
          ...(input.phone === undefined ? {} : { phone: input.phone?.trim() || null }),
          ...(input.avatarUrl === undefined ? {} : { avatarUrl: input.avatarUrl?.trim() || null }),
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
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        (error as { code?: string }).code === 'P2002'
      ) {
        throw new ConflictException('手机号已被其他账号使用')
      }

      throw error
    }
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

    // UserRole 只保存当前有效授权，撤销即删除，无需再判断 revokedAt
    const rows = await this.prisma.userRole.findMany({
      where: {
        scopeOrgUnitId: { in: orgIds },
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
        {
          // 教师账号可见性：正式组织归属落在范围内，且确实存在教师身份
          personnelProfile: {
            primaryOrganizationUnitId: { in: orgIds },
            teacherProfile: { isNot: null },
          },
        },
        {
          userRoles: {
            some: {
              scopeOrgUnitId: { in: orgIds },
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
        OR: [{ realName: { contains: query.keyword } }, { email: { contains: query.keyword } }],
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
      role: { code: string; name: string; dataScope: string; status: string }
      scopeOrgUnit: { name: string; type: string } | null
    }>,
    context: ListVisibilityContext,
  ): UserListItem {
    const now = new Date()

    const studentProfile = this.toStudentSummary(user, context)
    const teacherProfile = this.toTeacherSummary(user, context)

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
        // UserRole 只保存当前授权，撤销即删除，因此只需校验时间窗与角色状态
        const windowEffective =
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
          isEffective: windowEffective && scopeActive && qualificationEffective,
        }
      })

    return {
      id: user.id,
      realName: user.realName,
      email: user.email,
      phone: user.phone,
      status: user.status,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      roles,
      studentProfile,
      teacherProfile,
    }
  }

  /**
   * 学生档案摘要
   *
   * 1. 姓名统一取 User.realName，学生档案不再保存姓名；
   * 2. classId 允许为空（尚未分班），未分班学生不属于任何班级范围，故不外泄档案摘要。
   */
  private toStudentSummary(
    user: Prisma.UserGetPayload<{ select: typeof USER_SELECT }>,
    context: ListVisibilityContext,
  ): UserListItem['studentProfile'] {
    const profile = user.studentProfile

    if (!profile || !profile.classId) return null
    if (!withinScope(context.studentScope, profile.classId)) return null
    if (!context.userOrgIds.includes(profile.classId)) return null

    return {
      id: profile.id,
      studentNo: profile.studentNo,
      name: user.realName,
      classId: profile.classId,
      className: profile.class?.name ?? null,
      enrollmentStatus: profile.enrollmentStatus,
    }
  }

  /**
   * 教师档案摘要
   *
   * 教师身份挂在工作人员档案下：
   * - 所属组织取 personnelProfile.primaryOrganization（可能为学校/院系/专业）；
   * - 任职状态取 teacherProfile.status；
   * - 姓名即本人 User.realName，与 personnelProfile.user.realName 为同一行数据，
   *   因此不重复关联一次 user，避免多余查询。
   */
  private toTeacherSummary(
    user: Prisma.UserGetPayload<{ select: typeof USER_SELECT }>,
    context: ListVisibilityContext,
  ): UserListItem['teacherProfile'] {
    const personnel = user.personnelProfile
    const teacher = personnel?.teacherProfile

    if (!personnel || !teacher) return null

    const organization = personnel.primaryOrganization

    if (!withinScope(context.teacherScope, personnel.primaryOrganizationUnitId)) {
      return null
    }

    if (!context.userOrgIds.includes(organization.id)) return null

    return {
      id: teacher.id,
      teacherNo: teacher.teacherNo,
      realName: user.realName,
      organizationId: organization.id,
      organizationName: organization.name,
      organizationType: organization.type,
      status: teacher.status,
    }
  }
}
