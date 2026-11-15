import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'

import type { EmploymentStatus } from '../../../generated/prisma/client.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { OrganizationService } from '../rbac/organizations/organization.service.js'
import type { OrganizationTreeNode } from '../rbac/organizations/organization.types.js'
import { lockClassRows } from './coordinator-concurrency.js'
import { CoordinatorLifecycleService } from './coordinator-lifecycle.service.js'
import { assertUsableUser, conflict, isUniqueConstraintError } from './profile-validation.js'

/** 允许作为工作人员正式组织归属的节点类型：学校 / 院系 / 专业，不允许班级 */
const PRIMARY_ORGANIZATION_TYPES = new Set(['SCHOOL', 'DEPARTMENT', 'MAJOR'])

export interface CreatePersonnelProfileInput {
  userId: string
  employeeNo?: string | null
  primaryOrganizationUnitId: string
  positionName?: string | null
}

export interface UpdatePersonnelProfileInput {
  employeeNo?: string | null
  positionName?: string | null
  primaryOrganizationUnitId?: string
}

export interface PersonnelProfileListParams {
  organizationIds: string[]
  page: number
  pageSize: number
  keyword?: string
  employeeNo?: string
  realName?: string
  organizationId?: string
  status?: EmploymentStatus
  /** 只看同时具备教师身份的工作人员 */
  teacherOnly?: boolean
}

/**
 * 工作人员档案服务
 *
 * Phase 1 契约：
 * - 一名用户最多一份工作人员档案（userId 唯一），姓名统一取 User.realName；
 * - 正式组织归属只有一个，允许 SCHOOL / DEPARTMENT / MAJOR，不允许 CLASS；
 * - 教师身份（TeacherProfile）是可选扩展，状态变更必须与工作人员状态保持一致；
 * - 正式归属与角色授权范围严格分离：换组织不改变任何角色分配。
 */
@Injectable()
export class PersonnelProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizationService: OrganizationService,
    private readonly lifecycle: CoordinatorLifecycleService,
  ) {}

  async create(input: CreatePersonnelProfileInput, actorId: string) {
    await assertUsableUser(this.prisma, input.userId, '绑定用户')

    const existing = await this.prisma.personnelProfile.findUnique({
      where: { userId: input.userId },
      select: { id: true },
    })

    if (existing) throw conflict('该用户已存在工作人员档案')

    await this.assertPrimaryOrganization(input.primaryOrganizationUnitId)

    try {
      return await this.prisma.personnelProfile.create({
        data: {
          userId: input.userId,
          employeeNo: input.employeeNo?.trim() || null,
          primaryOrganizationUnitId: input.primaryOrganizationUnitId,
          positionName: input.positionName?.trim() || null,
          createdById: actorId,
          updatedById: actorId,
        },
      })
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('工号已存在或该用户已存在工作人员档案')
      }

      throw error
    }
  }

  async findById(id: string) {
    const profile = await this.prisma.personnelProfile.findUnique({ where: { id } })

    if (!profile) throw new NotFoundException('工作人员档案不存在')

    return profile
  }

  async findByUserId(userId: string) {
    return this.prisma.personnelProfile.findUnique({ where: { userId } })
  }

  /**
   * 修改工号、岗位与正式组织归属
   *
   * userId 不可变更：账号与档案的绑定关系只能通过新建档案建立。
   * 换组织时若该用户已有教师身份且存在不属于新组织子树的有效班主任任职，
   * 先拒绝并提示结束任职，避免出现「人已不在本院系但仍带本院系班级」的脏数据。
   */
  async updateBasic(profileId: string, input: UpdatePersonnelProfileInput, actorId: string) {
    const profile = await this.prisma.personnelProfile.findUnique({
      where: { id: profileId },
      select: {
        id: true,
        primaryOrganizationUnitId: true,
        teacherProfile: { select: { id: true } },
      },
    })

    if (!profile) throw new NotFoundException('工作人员档案不存在')

    const nextOrganizationId = input.primaryOrganizationUnitId

    if (nextOrganizationId && nextOrganizationId !== profile.primaryOrganizationUnitId) {
      await this.assertPrimaryOrganization(nextOrganizationId)

      if (profile.teacherProfile) {
        await this.assertNoOutOfScopeDuty(profile.teacherProfile.id, nextOrganizationId)
      }
    }

    try {
      return await this.prisma.personnelProfile.update({
        where: { id: profileId },
        data: {
          ...(input.employeeNo === undefined
            ? {}
            : { employeeNo: input.employeeNo?.trim() || null }),
          ...(input.positionName === undefined
            ? {}
            : { positionName: input.positionName?.trim() || null }),
          ...(nextOrganizationId ? { primaryOrganizationUnitId: nextOrganizationId } : {}),
          updatedById: actorId,
        },
      })
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('工号已存在')
      }

      throw error
    }
  }

  /**
   * 修改任职状态（在职 / 休假 / 离职）
   *
   * 同一事务内：
   * 1. 更新工作人员档案；
   * 2. 同步教师身份状态，保证两张表不会出现「工作人员离职、教师仍在职」；
   * 3. 重算该用户所有班级协管员资格，失去依据的分配立即撤销。
   * 事务提交后提升菜单缓存 generation。
   */
  async updateStatus(profileId: string, status: EmploymentStatus, actorId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const profile = await tx.personnelProfile.findUnique({
        where: { id: profileId },
        select: {
          id: true,
          userId: true,
          teacherProfile: { select: { id: true } },
        },
      })

      if (!profile) throw new NotFoundException('工作人员档案不存在')

      const assignments = await tx.userRole.findMany({
        where: {
          userId: profile.userId,
          role: { code: 'CLASS_COORDINATOR' },
          scopeOrgUnitId: { not: null },
        },
        select: { scopeOrgUnitId: true },
      })

      const classIds = [
        ...new Set(
          assignments.map((item) => item.scopeOrgUnitId).filter((id): id is string => Boolean(id)),
        ),
      ]

      await lockClassRows(tx, classIds)

      const updated = await tx.personnelProfile.update({
        where: { id: profileId },
        data: { status, updatedById: actorId },
      })

      if (profile.teacherProfile) {
        await tx.teacherProfile.update({
          where: { id: profile.teacherProfile.id },
          data: { status, updatedById: actorId },
        })
      }

      for (const classId of classIds) {
        await this.lifecycle.revokeIfIneligible(profile.userId, classId, actorId, tx)
      }

      return updated
    })

    await this.lifecycle.invalidateMenus('personnel.status')

    return result
  }

  /** 工作人员档案分页查询（范围由调用方计算后传入组织 ID） */
  async list(params: PersonnelProfileListParams) {
    // 姓名与关键字条件统一放进 AND，避免同名关系键互相覆盖导致范围条件被丢弃
    const matchFilters = [
      ...(params.realName ? [{ user: { realName: { contains: params.realName } } }] : []),
      ...(params.keyword
        ? [
            {
              OR: [
                { employeeNo: { contains: params.keyword } },
                { positionName: { contains: params.keyword } },
                { user: { realName: { contains: params.keyword } } },
                { teacherProfile: { is: { teacherNo: { contains: params.keyword } } } },
              ],
            },
          ]
        : []),
    ]

    const where = {
      primaryOrganizationUnitId: {
        in: params.organizationId ? [params.organizationId] : params.organizationIds,
      },
      ...(params.status ? { status: params.status } : {}),
      ...(params.employeeNo ? { employeeNo: params.employeeNo } : {}),
      ...(params.teacherOnly ? { teacherProfile: { isNot: null } } : {}),
      ...(matchFilters.length > 0 ? { AND: matchFilters } : {}),
    }

    const [total, rows] = await Promise.all([
      this.prisma.personnelProfile.count({ where }),
      this.prisma.personnelProfile.findMany({
        where,
        select: {
          id: true,
          userId: true,
          employeeNo: true,
          positionName: true,
          status: true,
          updatedAt: true,
          primaryOrganization: { select: { id: true, name: true, type: true } },
          user: {
            select: { id: true, realName: true, email: true, phone: true, status: true },
          },
          teacherProfile: { select: { id: true, teacherNo: true, title: true } },
        },
        orderBy: [{ employeeNo: 'asc' }, { id: 'asc' }],
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
    ])

    return {
      total,
      list: rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        employeeNo: row.employeeNo,
        positionName: row.positionName,
        status: row.status,
        organizationId: row.primaryOrganization.id,
        organizationName: row.primaryOrganization.name,
        organizationType: row.primaryOrganization.type,
        realName: row.user.realName,
        email: row.user.email,
        phone: row.user.phone,
        accountStatus: row.user.status,
        isTeacher: row.teacherProfile !== null,
        teacherNo: row.teacherProfile?.teacherNo ?? null,
        title: row.teacherProfile?.title ?? null,
        updatedAt: row.updatedAt,
      })),
    }
  }

  /** 工作人员详情：档案、账号摘要、正式组织、教师身份与审计信息 */
  async findDetail(profileId: string) {
    const profile = await this.prisma.personnelProfile.findUnique({
      where: { id: profileId },
      select: {
        id: true,
        userId: true,
        employeeNo: true,
        positionName: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            id: true,
            realName: true,
            email: true,
            phone: true,
            avatarUrl: true,
            status: true,
          },
        },
        primaryOrganization: { select: { id: true, name: true, type: true } },
        teacherProfile: {
          select: {
            id: true,
            teacherNo: true,
            title: true,
            professionalInfo: true,
            status: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        createdBy: { select: { id: true, realName: true } },
        updatedBy: { select: { id: true, realName: true } },
      },
    })

    if (!profile) throw new NotFoundException('工作人员档案不存在')

    return {
      id: profile.id,
      userId: profile.userId,
      employeeNo: profile.employeeNo,
      positionName: profile.positionName,
      status: profile.status,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
      account: profile.user,
      organization: profile.primaryOrganization,
      teacherProfile: profile.teacherProfile,
      createdBy: profile.createdBy,
      updatedBy: profile.updatedBy,
    }
  }

  /** 组织节点校验：必须存在、属于 SCHOOL / DEPARTMENT / MAJOR 且整条路径可用 */
  async assertPrimaryOrganization(organizationId: string): Promise<OrganizationTreeNode> {
    const node = await this.organizationService.findById(organizationId)

    if (!PRIMARY_ORGANIZATION_TYPES.has(node.type)) {
      throw new BadRequestException('工作人员的正式组织归属不能是班级，请选择院系或专业')
    }

    if (!(await this.organizationService.isPathActive(organizationId))) {
      throw new BadRequestException('正式组织归属或其上级组织已停用，不能建立关联')
    }

    return node
  }

  /** 换组织前置校验：教师不得保留在新组织子树之外的有效班主任任职 */
  private async assertNoOutOfScopeDuty(teacherProfileId: string, targetOrganizationId: string) {
    const subtreeIds = await this.organizationService.getSubtreeIds(targetOrganizationId)
    const now = new Date()

    const outOfScopeDuties = await this.prisma.teacherClassDuty.count({
      where: {
        teacherId: teacherProfileId,
        revokedAt: null,
        validFrom: { lte: now },
        OR: [{ validUntil: null }, { validUntil: { gt: now } }],
        classId: { notIn: subtreeIds },
      },
    })

    if (outOfScopeDuties > 0) {
      throw new ConflictException('该教师仍存在不属于目标组织范围的有效班主任任职，请先结束任职')
    }
  }
}
