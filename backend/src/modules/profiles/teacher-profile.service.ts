import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'

import type { EmploymentStatus } from '../../../generated/prisma/client.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { OrganizationService } from '../rbac/organizations/organization.service.js'
import { lockClassRows } from './coordinator-concurrency.js'
import { CoordinatorLifecycleService } from './coordinator-lifecycle.service.js'
import {
  assertOrganizationNode,
  assertUsableUser,
  conflict,
  isUniqueConstraintError,
} from './profile-validation.js'

export interface CreateTeacherProfileInput {
  userId: string
  teacherNo: string
  departmentId: string
}

export interface TeacherProfileListParams {
  departmentIds: string[]
  page: number
  pageSize: number
  keyword?: string
  teacherNo?: string
  name?: string
  departmentId?: string
  employmentStatus?: EmploymentStatus
}

/**
 * 教师档案服务
 *
 * v1 只维护一个主要所属院系；跨院系工作通过指导/任职关系表达，
 * 不因任职关系自动扩大教师的数据权限。
 */
@Injectable()
export class TeacherProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizationService: OrganizationService,
    private readonly lifecycle: CoordinatorLifecycleService,
  ) {}

  async create(input: CreateTeacherProfileInput, actorId: string) {
    await assertUsableUser(this.prisma, input.userId, '教师账号')

    const existing = await this.prisma.teacherProfile.findUnique({
      where: { userId: input.userId },
      select: { id: true },
    })

    if (existing) throw conflict('该用户已存在教师档案')

    await assertOrganizationNode(
      this.organizationService,
      input.departmentId,
      'DEPARTMENT',
      '教师所属院系',
    )

    try {
      return await this.prisma.teacherProfile.create({
        data: {
          userId: input.userId,
          teacherNo: input.teacherNo.trim(),
          departmentId: input.departmentId,
          createdById: actorId,
          updatedById: actorId,
        },
      })
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('工号或教师账号已存在')
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
    return this.prisma.teacherProfile.findUnique({ where: { userId } })
  }

  /**
   * 离职/复职
   *
   * 状态变更后在同一事务内重算该教师所有班级的协管员资格；
   * 失去全部资格的 CLASS_COORDINATOR 会被软撤销。
   */
  async updateEmploymentStatus(
    profileId: string,
    employmentStatus: EmploymentStatus,
    actorId: string,
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      const profile = await tx.teacherProfile.findUnique({
        where: { id: profileId },
        select: { id: true, userId: true },
      })

      if (!profile) throw new NotFoundException('教师档案不存在')

      const assignments = await tx.userRole.findMany({
        where: {
          userId: profile.userId,
          revokedAt: null,
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

      const updated = await tx.teacherProfile.update({
        where: { id: profileId },
        data: { employmentStatus, updatedById: actorId },
      })

      for (const classId of classIds) {
        await this.lifecycle.revokeIfIneligible(profile.userId, classId, actorId, tx)
      }

      return updated
    })

    await this.lifecycle.invalidateMenus('coordinator.teacher.status')

    return result
  }

  /** 教师档案分页查询（范围由调用方计算后传入 departmentIds） */
  async list(params: TeacherProfileListParams) {
    const where = {
      departmentId: {
        in: params.departmentId ? [params.departmentId] : params.departmentIds,
      },
      ...(params.employmentStatus ? { employmentStatus: params.employmentStatus } : {}),
      ...(params.teacherNo ? { teacherNo: params.teacherNo } : {}),
      ...(params.name ? { user: { displayName: { contains: params.name } } } : {}),
      ...(params.keyword
        ? {
            OR: [
              { teacherNo: { contains: params.keyword } },
              { user: { displayName: { contains: params.keyword } } },
            ],
          }
        : {}),
    }

    const [total, rows] = await Promise.all([
      this.prisma.teacherProfile.count({ where }),
      this.prisma.teacherProfile.findMany({
        where,
        select: {
          id: true,
          teacherNo: true,
          departmentId: true,
          employmentStatus: true,
          updatedAt: true,
          user: { select: { id: true, displayName: true, email: true, status: true } },
          department: { select: { id: true, name: true } },
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
        name: row.user.displayName,
        email: row.user.email,
        accountStatus: row.user.status,
        departmentId: row.departmentId,
        departmentName: row.department.name,
        employmentStatus: row.employmentStatus,
        updatedAt: row.updatedAt,
      })),
    }
  }

  /** 教师详情：账号摘要、院系、审计信息与授权范围内的班级职责 */
  async findDetail(profileId: string, allowedClassIds: string[]) {
    const profile = await this.prisma.teacherProfile.findUnique({
      where: { id: profileId },
      select: {
        id: true,
        teacherNo: true,
        departmentId: true,
        employmentStatus: true,
        createdAt: true,
        updatedAt: true,
        user: { select: { id: true, displayName: true, email: true, status: true } },
        department: { select: { id: true, name: true, type: true } },
        createdBy: { select: { id: true, displayName: true } },
        updatedBy: { select: { id: true, displayName: true } },
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
      name: profile.user.displayName,
      departmentId: profile.departmentId,
      departmentName: profile.department.name,
      employmentStatus: profile.employmentStatus,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
      createdBy: profile.createdBy,
      updatedBy: profile.updatedBy,
      user: profile.user,
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

  /**
   * 调整教师主要所属院系
   *
   * 存在有效班级职责且职责班级不在目标院系时，返回业务冲突，
   * 不静默撤销职责、不自动改派班级。
   */
  async adjustDepartment(profileId: string, targetDepartmentId: string, actorId: string) {
    await assertOrganizationNode(
      this.organizationService,
      targetDepartmentId,
      'DEPARTMENT',
      '目标院系',
    )

    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM teacher_profiles WHERE id = ${profileId} FOR UPDATE`

      const profile = await tx.teacherProfile.findUnique({
        where: { id: profileId },
        select: { id: true, departmentId: true },
      })

      if (!profile) throw new NotFoundException('教师档案不存在')

      if (profile.departmentId === targetDepartmentId) {
        return tx.teacherProfile.findUniqueOrThrow({ where: { id: profileId } })
      }

      const now = new Date()
      const duties = await tx.teacherClassDuty.findMany({
        where: {
          teacherId: profileId,
          revokedAt: null,
          validFrom: { lte: now },
          OR: [{ validUntil: null }, { validUntil: { gt: now } }],
        },
        select: { id: true, classId: true },
      })

      for (const duty of duties) {
        const inTarget = await this.organizationService.isWithinScope(
          duty.classId,
          targetDepartmentId,
        )

        if (!inTarget) {
          throw new ConflictException(
            '教师仍有不属于目标院系的班级职责，请先结束相关任职后再调整院系',
          )
        }
      }

      return tx.teacherProfile.update({
        where: { id: profileId },
        data: { departmentId: targetDepartmentId, updatedById: actorId },
      })
    })
  }

  async listByDepartment(departmentId: string, includeInactive = false) {
    return this.prisma.teacherProfile.findMany({
      where: {
        departmentId,
        ...(includeInactive ? {} : { employmentStatus: 'ACTIVE' }),
      },
      orderBy: { teacherNo: 'asc' },
    })
  }
}
