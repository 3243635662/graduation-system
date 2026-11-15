import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'

import type { EnrollmentStatus } from '../../../generated/prisma/client.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { AuditService } from '../audit/audit.service.js'
import { OrganizationService } from '../rbac/organizations/organization.service.js'
import { lockClassRows } from './coordinator-concurrency.js'
import { CoordinatorLifecycleService } from './coordinator-lifecycle.service.js'
import {
  assertOrganizationNode,
  assertUsableUser,
  conflict,
  isUniqueConstraintError,
} from './profile-validation.js'

export interface CreateStudentProfileInput {
  userId: string
  studentNo: string
  classId?: string | null
  enrollmentYear?: number | null
}

export interface UpdateStudentProfileInput {
  studentNo?: string
  enrollmentYear?: number | null
}

export interface StudentProfileListParams {
  classIds: string[]
  page: number
  pageSize: number
  keyword?: string
  studentNo?: string
  realName?: string
  classId?: string
  enrollmentStatus?: EnrollmentStatus
  /** 未分班学生（classId IS NULL） */
  unassignedOnly?: boolean
}

/**
 * 学生档案服务
 *
 * Phase 1 契约：
 * - 档案必须绑定登录账号（userId 必填唯一），姓名统一取 User.realName；
 * - classId 可空：允许新注册学生尚未分班；
 * - 只保存 classId，专业/院系/学校由组织树推导；
 * - 班级及其祖先必须 ACTIVE 才能建立归属；
 * - 转班与首次分班统一走 changeClass()，保证历史完整。
 */
@Injectable()
export class StudentProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizationService: OrganizationService,
    private readonly lifecycle: CoordinatorLifecycleService,
    private readonly audit: AuditService,
  ) {}

  async create(input: CreateStudentProfileInput, actorId: string) {
    await assertUsableUser(this.prisma, input.userId, '绑定用户')

    const bound = await this.prisma.studentProfile.findUnique({
      where: { userId: input.userId },
      select: { id: true },
    })

    if (bound) throw conflict('该用户已绑定学生档案')

    if (input.classId) {
      await assertOrganizationNode(this.organizationService, input.classId, 'CLASS', '学生所属班级')
    }

    try {
      return await this.prisma.studentProfile.create({
        data: {
          userId: input.userId,
          studentNo: input.studentNo.trim(),
          classId: input.classId ?? null,
          enrollmentYear: input.enrollmentYear ?? null,
          createdById: actorId,
          updatedById: actorId,
        },
      })
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('学号或绑定用户已存在')
      }

      throw error
    }
  }

  async findById(id: string) {
    const profile = await this.prisma.studentProfile.findUnique({ where: { id } })

    if (!profile) throw new NotFoundException('学生档案不存在')

    return profile
  }

  async findByUserId(userId: string) {
    return this.prisma.studentProfile.findUnique({ where: { userId } })
  }

  /** 学生档案分页查询（范围由调用方计算后传入 classIds） */
  async list(params: StudentProfileListParams) {
    const where = {
      ...(params.unassignedOnly
        ? { classId: null }
        : { classId: { in: params.classId ? [params.classId] : params.classIds } }),
      ...(params.enrollmentStatus ? { enrollmentStatus: params.enrollmentStatus } : {}),
      ...(params.studentNo ? { studentNo: params.studentNo } : {}),
      ...(params.realName ? { user: { realName: { contains: params.realName } } } : {}),
      ...(params.keyword
        ? {
            OR: [
              { studentNo: { contains: params.keyword } },
              { user: { realName: { contains: params.keyword } } },
            ],
          }
        : {}),
    }

    const [total, rows] = await Promise.all([
      this.prisma.studentProfile.count({ where }),
      this.prisma.studentProfile.findMany({
        where,
        select: {
          id: true,
          studentNo: true,
          classId: true,
          enrollmentYear: true,
          enrollmentStatus: true,
          userId: true,
          updatedAt: true,
          user: {
            select: {
              realName: true,
              email: true,
              status: true,
            },
          },
          class: {
            select: {
              id: true,
              name: true,
              parent: { select: { id: true, name: true, type: true } },
            },
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
    ])

    return {
      total,
      list: rows.map((row) => ({
        id: row.id,
        studentNo: row.studentNo,
        userId: row.userId,
        realName: row.user.realName,
        email: row.user.email,
        accountStatus: row.user.status,
        classId: row.classId,
        className: row.class?.name ?? null,
        majorName: row.class?.parent?.type === 'MAJOR' ? row.class.parent.name : null,
        enrollmentYear: row.enrollmentYear,
        enrollmentStatus: row.enrollmentStatus,
        updatedAt: row.updatedAt,
      })),
    }
  }

  /** 学生详情：组织路径、转班历史与账号摘要 */
  async findDetail(profileId: string) {
    const profile = await this.prisma.studentProfile.findUnique({
      where: { id: profileId },
      select: {
        id: true,
        studentNo: true,
        classId: true,
        enrollmentYear: true,
        enrollmentStatus: true,
        userId: true,
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
        class: {
          select: {
            id: true,
            name: true,
            parent: {
              select: {
                id: true,
                name: true,
                type: true,
                parent: { select: { id: true, name: true, type: true } },
              },
            },
          },
        },
        updatedBy: { select: { id: true, realName: true } },
        transfers: {
          select: {
            id: true,
            fromClassId: true,
            toClassId: true,
            reason: true,
            transferredAt: true,
            fromClass: { select: { name: true } },
            toClass: { select: { name: true } },
            transferredBy: { select: { id: true, realName: true } },
          },
          orderBy: { transferredAt: 'desc' },
        },
      },
    })

    if (!profile) throw new NotFoundException('学生档案不存在')

    const major = profile.class?.parent ?? null
    const department = major?.parent ?? null

    return {
      id: profile.id,
      studentNo: profile.studentNo,
      realName: profile.user.realName,
      classId: profile.classId,
      className: profile.class?.name ?? null,
      majorName: major?.name ?? null,
      departmentName: department?.name ?? null,
      enrollmentYear: profile.enrollmentYear,
      enrollmentStatus: profile.enrollmentStatus,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
      updatedBy: profile.updatedBy,
      account: profile.user,
      transfers: profile.transfers.map((item) => ({
        id: item.id,
        fromClassId: item.fromClassId,
        fromClassName: item.fromClass?.name ?? null,
        toClassId: item.toClassId,
        toClassName: item.toClass.name,
        reason: item.reason,
        transferredAt: item.transferredAt,
        transferredBy: item.transferredBy,
      })),
    }
  }

  /**
   * 修改学号与入学年份。
   *
   * 班级归属只能通过 changeClass() 改变，避免绕过转班历史。
   */
  async updateBasic(profileId: string, input: UpdateStudentProfileInput, actorId: string) {
    const profile = await this.findById(profileId)

    try {
      return await this.prisma.studentProfile.update({
        where: { id: profileId },
        data: {
          ...(input.studentNo ? { studentNo: input.studentNo.trim() } : {}),
          ...(input.enrollmentYear === undefined ? {} : { enrollmentYear: input.enrollmentYear }),
          updatedById: actorId,
        },
      })
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('学号已存在')
      }

      throw error
    } finally {
      void profile
    }
  }

  /**
   * 首次分班或转班
   *
   * 锁学生档案行 + 原/目标班级行，事务内写档案、历史并重算资格。
   * fromClassId 为空表示首次分班，历史记录的 fromClassId 允许为空。
   */
  async changeClass(
    profileId: string,
    targetClassId: string,
    reason: string,
    actorId: string,
    expectedClassId?: string | null,
  ) {
    const normalizedReason = reason.trim()

    if (!normalizedReason) throw new BadRequestException('分班或转班原因不能为空')
    if (normalizedReason.length > 255) {
      throw new BadRequestException('分班或转班原因不能超过 255 个字符')
    }

    await assertOrganizationNode(this.organizationService, targetClassId, 'CLASS', '目标班级')

    const updated = await this.prisma.$transaction(async (tx) => {
      // 先锁学生记录，保证同一学生的并发变更串行执行
      await tx.$queryRaw`SELECT id FROM student_profiles WHERE id = ${profileId} FOR UPDATE`

      const profile = await tx.studentProfile.findUnique({
        where: { id: profileId },
        select: { id: true, userId: true, classId: true },
      })

      if (!profile) throw new NotFoundException('学生档案不存在')

      if (profile.classId === targetClassId) {
        throw new BadRequestException('学生已经在该班级，无需调整')
      }

      await lockClassRows(
        tx,
        [profile.classId, targetClassId].filter((id): id is string => Boolean(id)),
      )

      // 锁内重新读取，防止等待锁期间被其他事务改变
      const current = await tx.studentProfile.findUniqueOrThrow({
        where: { id: profileId },
        select: { classId: true, userId: true },
      })

      const fromClassId = profile.classId

      if (
        current.classId !== fromClassId ||
        (expectedClassId !== undefined && current.classId !== expectedClassId)
      ) {
        throw new ConflictException('学生班级已被其他操作修改，请刷新后重试')
      }

      const result = await tx.studentProfile.update({
        where: { id: profileId },
        data: { classId: targetClassId, updatedById: actorId },
      })

      await tx.studentClassTransfer.create({
        data: {
          studentProfileId: profileId,
          fromClassId,
          toClassId: targetClassId,
          reason: normalizedReason,
          transferredById: actorId,
        },
      })

      if (profile.userId && fromClassId) {
        await this.lifecycle.revokeStudentBasisIfOnly(profile.userId, fromClassId, actorId, tx)
      }

      // 审计与业务变更同属一个事务：任一步失败都会整体回滚
      await this.audit.record(
        {
          actor: { type: 'USER', userId: actorId },
          action: fromClassId ? 'student.profile.transfer' : 'student.profile.assign-class',
          targetType: 'STUDENT_PROFILE',
          targetId: profileId,
          scopeOrgUnitId: targetClassId,
          source: 'WEB',
          before: { classId: fromClassId },
          after: { classId: targetClassId },
          reason: normalizedReason,
        },
        tx,
      )

      return result
    })

    await this.lifecycle.invalidateMenus('student-profile.change-class')

    return updated
  }

  /** 兼容旧调用名：已有班级时等价于转班 */
  async transfer(
    profileId: string,
    targetClassId: string,
    reason: string,
    actorId: string,
    expectedClassId?: string,
  ) {
    return this.changeClass(profileId, targetClassId, reason, actorId, expectedClassId)
  }

  async updateEnrollmentStatus(
    profileId: string,
    enrollmentStatus: EnrollmentStatus,
    actorId: string,
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      const profile = await tx.studentProfile.findUnique({
        where: { id: profileId },
        select: { id: true, userId: true, classId: true },
      })

      if (!profile) throw new NotFoundException('学生档案不存在')

      await lockClassRows(tx, profile.classId ? [profile.classId] : [])

      const updated = await tx.studentProfile.update({
        where: { id: profileId },
        data: { enrollmentStatus, updatedById: actorId },
      })

      const removedRoles =
        profile.userId && profile.classId
          ? await this.lifecycle.revokeIfIneligible(profile.userId, profile.classId, actorId, tx)
          : []

      return { updated, removedRoles }
    })

    await this.lifecycle.invalidateMenus('coordinator.student.status')

    return result.updated
  }

  /** 按班级查询；默认只返回在籍学生 */
  async listByClass(classId: string, includeInactive = false) {
    return this.prisma.studentProfile.findMany({
      where: {
        classId,
        ...(includeInactive ? {} : { enrollmentStatus: 'ACTIVE' }),
      },
      orderBy: { studentNo: 'asc' },
      include: { user: { select: { realName: true, status: true } } },
    })
  }

  /** 未来导入名册时使用：学号必须唯一 */
  async assertStudentNoAvailable(studentNo: string) {
    const existing = await this.prisma.studentProfile.findUnique({
      where: { studentNo: studentNo.trim() },
      select: { id: true },
    })

    if (existing) throw new BadRequestException('学号已存在')
  }
}
