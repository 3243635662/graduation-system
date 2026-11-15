import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'

import type { EmploymentStatus, Prisma } from '../../../generated/prisma/client.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { OrganizationService } from '../rbac/organizations/organization.service.js'
import { lockClassRows } from './coordinator-concurrency.js'
import { CoordinatorLifecycleService } from './coordinator-lifecycle.service.js'
import { conflict, isUniqueConstraintError } from './profile-validation.js'

export interface CreateTeacherProfileInput {
  personnelProfileId: string
  teacherNo: string
  title?: string | null
  professionalInfo?: string | null
}

export interface UpdateTeacherProfileInput {
  teacherNo?: string
  title?: string | null
  professionalInfo?: string | null
}

export interface TeacherProfileListParams {
  organizationIds: string[]
  page: number
  pageSize: number
  keyword?: string
  teacherNo?: string
  realName?: string
  organizationId?: string
  employmentStatus?: EmploymentStatus
}

/**
 * 教师档案服务
 *
 * Phase 1 契约：
 * - 教师身份挂在 PersonnelProfile 之下，不直接关联 User；
 * - 所属组织统一取 personnelProfile.primaryOrganizationUnit；
 * - 跨院系授课通过班主任任职等关系表达，不改变正式组织归属。
 */
@Injectable()
export class TeacherProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizationService: OrganizationService,
    private readonly lifecycle: CoordinatorLifecycleService,
  ) {}

  async create(input: CreateTeacherProfileInput, actorId: string) {
    const personnel = await this.prisma.personnelProfile.findUnique({
      where: { id: input.personnelProfileId },
      select: { id: true, userId: true, primaryOrganizationUnitId: true },
    })

    if (!personnel) {
      throw new NotFoundException('工作人员档案不存在，请先创建工作人员档案')
    }

    const existing = await this.prisma.teacherProfile.findUnique({
      where: { personnelProfileId: input.personnelProfileId },
      select: { id: true },
    })

    if (existing) throw conflict('该工作人员已存在教师身份')

    try {
      return await this.prisma.teacherProfile.create({
        data: {
          personnelProfileId: input.personnelProfileId,
          teacherNo: input.teacherNo.trim(),
          title: input.title?.trim() || null,
          professionalInfo: input.professionalInfo?.trim() || null,
          createdById: actorId,
          updatedById: actorId,
        },
      })
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('教师编号已存在或该工作人员已有教师身份')
      }

      throw error
    }
  }

  async findById(id: string) {
    const profile = await this.prisma.teacherProfile.findUnique({ where: { id } })

    if (!profile) throw new NotFoundException('教师档案不存在')

    return profile
  }

  async findByUserId(userId: string) {
    return this.prisma.teacherProfile.findFirst({
      where: { personnelProfile: { userId } },
    })
  }

  /**
   * 离职/复职
   *
   * 同时更新工作人员任职状态，并在同一事务内重算该教师所有班级的协管员资格。
   */
  async updateEmploymentStatus(
    profileId: string,
    employmentStatus: EmploymentStatus,
    actorId: string,
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      const profile = await tx.teacherProfile.findUnique({
        where: { id: profileId },
        select: {
          id: true,
          personnelProfileId: true,
          personnelProfile: { select: { userId: true } },
        },
      })

      if (!profile) throw new NotFoundException('教师档案不存在')

      const userId = profile.personnelProfile.userId

      const assignments = await tx.userRole.findMany({
        where: {
          userId,
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

      await tx.personnelProfile.update({
        where: { id: profile.personnelProfileId },
        data: { status: employmentStatus, updatedById: actorId },
      })

      const updated = await tx.teacherProfile.update({
        where: { id: profileId },
        data: { status: employmentStatus, updatedById: actorId },
      })

      for (const classId of classIds) {
        await this.lifecycle.revokeIfIneligible(userId, classId, actorId, tx)
      }

      return updated
    })

    await this.lifecycle.invalidateMenus('coordinator.teacher.status')

    return result
  }

  /** 修改教师编号、职称与专业资料 */
  async updateBasic(profileId: string, input: UpdateTeacherProfileInput, actorId: string) {
    await this.findById(profileId)

    try {
      return await this.prisma.teacherProfile.update({
        where: { id: profileId },
        data: {
          ...(input.teacherNo ? { teacherNo: input.teacherNo.trim() } : {}),
          ...(input.title === undefined ? {} : { title: input.title?.trim() || null }),
          ...(input.professionalInfo === undefined
            ? {}
            : { professionalInfo: input.professionalInfo?.trim() || null }),
          updatedById: actorId,
        },
      })
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('教师编号已存在')
      }

      throw error
    }
  }

  /** 教师档案分页查询（范围由调用方计算后传入组织 ID） */
  async list(params: TeacherProfileListParams) {
    /**
     * 用 AND 组合条件：personnelProfile 是同一个关系键，
     * 若与 realName 条件平铺在同一对象上，后者会覆盖组织范围条件导致越权。
     */
    const filters: Prisma.TeacherProfileWhereInput[] = []

    if (params.employmentStatus) filters.push({ status: params.employmentStatus })
    if (params.teacherNo) filters.push({ teacherNo: params.teacherNo })

    if (params.realName) {
      filters.push({ personnelProfile: { user: { realName: { contains: params.realName } } } })
    }

    if (params.keyword) {
      filters.push({
        OR: [
          { teacherNo: { contains: params.keyword } },
          { personnelProfile: { user: { realName: { contains: params.keyword } } } },
        ],
      })
    }

    const where: Prisma.TeacherProfileWhereInput = {
      AND: [
        {
          personnelProfile: {
            primaryOrganizationUnitId: {
              in: params.organizationId ? [params.organizationId] : params.organizationIds,
            },
          },
        },
        ...filters,
      ],
    }

    const [total, rows] = await Promise.all([
      this.prisma.teacherProfile.count({ where }),
      this.prisma.teacherProfile.findMany({
        where,
        select: {
          id: true,
          teacherNo: true,
          title: true,
          status: true,
          updatedAt: true,
          personnelProfile: {
            select: {
              id: true,
              employeeNo: true,
              positionName: true,
              primaryOrganizationUnitId: true,
              primaryOrganization: { select: { id: true, name: true, type: true } },
              user: {
                select: { id: true, realName: true, email: true, phone: true, status: true },
              },
            },
          },
        },
        orderBy: [{ teacherNo: 'asc' }, { id: 'asc' }],
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
    ])

    return {
      total,
      list: rows.map((row) => ({
        id: row.id,
        teacherNo: row.teacherNo,
        title: row.title,
        status: row.status,
        personnelProfileId: row.personnelProfile.id,
        employeeNo: row.personnelProfile.employeeNo,
        positionName: row.personnelProfile.positionName,
        organizationId: row.personnelProfile.primaryOrganizationUnitId,
        organizationName: row.personnelProfile.primaryOrganization.name,
        organizationType: row.personnelProfile.primaryOrganization.type,
        userId: row.personnelProfile.user.id,
        realName: row.personnelProfile.user.realName,
        email: row.personnelProfile.user.email,
        phone: row.personnelProfile.user.phone,
        accountStatus: row.personnelProfile.user.status,
        updatedAt: row.updatedAt,
      })),
    }
  }

  /** 教师详情：账号摘要、正式组织、审计信息与授权范围内的班级职责 */
  async findDetail(profileId: string, allowedClassIds: string[]) {
    const profile = await this.prisma.teacherProfile.findUnique({
      where: { id: profileId },
      select: {
        id: true,
        teacherNo: true,
        title: true,
        professionalInfo: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        personnelProfile: {
          select: {
            id: true,
            employeeNo: true,
            positionName: true,
            status: true,
            primaryOrganizationUnitId: true,
            primaryOrganization: { select: { id: true, name: true, type: true } },
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
          },
        },
        createdBy: { select: { id: true, realName: true } },
        updatedBy: { select: { id: true, realName: true } },
        classDuties: {
          where: { classId: { in: allowedClassIds } },
          select: {
            id: true,
            classId: true,
            dutyType: true,
            validFrom: true,
            validUntil: true,
            revokedAt: true,
            createdAt: true,
            class: { select: { id: true, name: true } },
          },
          orderBy: [{ validFrom: 'desc' }],
        },
      },
    })

    if (!profile) throw new NotFoundException('教师档案不存在')

    const now = new Date()

    return {
      id: profile.id,
      teacherNo: profile.teacherNo,
      title: profile.title,
      professionalInfo: profile.professionalInfo,
      status: profile.status,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
      createdBy: profile.createdBy,
      updatedBy: profile.updatedBy,
      personnelProfile: profile.personnelProfile,
      classDuties: profile.classDuties.map((item) => ({
        id: item.id,
        classId: item.classId,
        className: item.class.name,
        dutyType: item.dutyType,
        validFrom: item.validFrom,
        validUntil: item.validUntil,
        revokedAt: item.revokedAt,
        isEffective:
          item.revokedAt === null &&
          item.validFrom.getTime() <= now.getTime() &&
          (!item.validUntil || item.validUntil.getTime() > now.getTime()),
      })),
    }
  }

  /** 按正式组织归属查询教师；默认只返回在职教师 */
  async listByDepartment(departmentId: string, includeInactive = false) {
    return this.prisma.teacherProfile.findMany({
      where: {
        personnelProfile: { primaryOrganizationUnitId: departmentId },
        ...(includeInactive ? {} : { status: 'ACTIVE' }),
      },
      orderBy: { teacherNo: 'asc' },
      include: {
        personnelProfile: {
          select: { userId: true, user: { select: { realName: true } } },
        },
      },
    })
  }

  /**
   * 教师可管理的班级 ID 集合
   *
   * 由班主任任职与教师正式院系推导，供详情接口裁剪班级职责使用。
   */
  async resolveVisibleClassIds(profileId: string, scopeClassIds: string[]): Promise<string[]> {
    const duties = await this.prisma.teacherClassDuty.findMany({
      where: { teacherId: profileId, classId: { in: scopeClassIds } },
      select: { classId: true },
    })

    return [...new Set(duties.map((item) => item.classId))]
  }

  /** 组织节点校验：教师正式归属允许是学校、院系或专业，不允许班级 */
  async assertPrimaryOrganization(organizationId: string) {
    const node = await this.organizationService.findById(organizationId).catch(() => null)

    if (!node) {
      throw new NotFoundException('组织节点不存在')
    }

    if (node.type === 'CLASS') {
      throw new ConflictException('工作人员的正式组织归属不能是班级，请选择院系或专业')
    }

    return node
  }
}
