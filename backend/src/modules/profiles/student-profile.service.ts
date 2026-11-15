import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'

import type { EnrollmentStatus } from '../../../generated/prisma/client.js'
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

export interface CreateStudentProfileInput {
  userId?: string | null
  studentNo: string
  name: string
  classId: string
}

export interface StudentProfileListParams {
  classIds: string[]
  page: number
  pageSize: number
  keyword?: string
  studentNo?: string
  name?: string
  classId?: string
  enrollmentStatus?: EnrollmentStatus
  hasAccount?: boolean
}

/**
 * 学生档案服务
 *
 * - 档案允许先于账号存在（userId 可空）；
 * - userId / studentNo 唯一；
 * - 只保存 classId，专业/院系/学校由组织树推导；
 * - 班级及其祖先必须 ACTIVE 才能建立归属。
 */
@Injectable()
export class StudentProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizationService: OrganizationService,
    private readonly lifecycle: CoordinatorLifecycleService,
  ) {}

  async create(input: CreateStudentProfileInput, actorId: string) {
    await assertOrganizationNode(this.organizationService, input.classId, 'CLASS', '学生所属班级')

    if (input.userId) {
      await assertUsableUser(this.prisma, input.userId, '绑定用户')

      const bound = await this.prisma.studentProfile.findUnique({
        where: { userId: input.userId },
        select: { id: true },
      })

      if (bound) throw conflict('该用户已绑定学生档案')
    }

    try {
      return await this.prisma.studentProfile.create({
        data: {
          userId: input.userId ?? null,
          studentNo: input.studentNo.trim(),
          name: input.name.trim(),
          classId: input.classId,
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

  /**
   * 注册完成后绑定已有档案
   *
   * 同一档案只能绑定一个 User，同一 User 也只能绑定一个学生档案。
   */
  async bindUser(profileId: string, userId: string) {
    const profile = await this.findById(profileId)

    if (profile.userId) {
      if (profile.userId === userId) return profile

      throw new ConflictException('该学生档案已绑定其他用户')
    }

    await assertUsableUser(this.prisma, userId)

    const bound = await this.prisma.studentProfile.findUnique({
      where: { userId },
      select: { id: true },
    })

    if (bound) throw new ConflictException('该用户已绑定其他学生档案')

    try {
      return await this.prisma.studentProfile.update({
        where: { id: profileId },
        data: { userId },
      })
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('该用户已绑定其他学生档案')
      }

      throw error
    }
  }

  /** 学生档案分页查询（范围由调用方计算后传入 classIds） */
  async list(params: StudentProfileListParams) {
    const where = {
      classId: {
        in: params.classId ? [params.classId] : params.classIds,
      },
      ...(params.enrollmentStatus ? { enrollmentStatus: params.enrollmentStatus } : {}),
      ...(params.hasAccount === undefined
        ? {}
        : params.hasAccount
          ? { userId: { not: null } }
          : { userId: null }),
      ...(params.studentNo ? { studentNo: params.studentNo } : {}),
      ...(params.name ? { name: { contains: params.name } } : {}),
      ...(params.keyword
        ? {
            OR: [
              { studentNo: { contains: params.keyword } },
              { name: { contains: params.keyword } },
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
          name: true,
          classId: true,
          enrollmentStatus: true,
          userId: true,
          updatedAt: true,
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
        name: row.name,
        classId: row.classId,
        className: row.class.name,
        majorName: row.class.parent?.type === 'MAJOR' ? row.class.parent.name : null,
        enrollmentStatus: row.enrollmentStatus,
        hasAccount: Boolean(row.userId),
        updatedAt: row.updatedAt,
      })),
    }
  }

  /** 学生详情：组织路径、转班历史，账号摘要由权限决定是否返回 */
  async findDetail(profileId: string, includeAccount: boolean) {
    const profile = await this.prisma.studentProfile.findUnique({
      where: { id: profileId },
      select: {
        id: true,
        studentNo: true,
        name: true,
        classId: true,
        enrollmentStatus: true,
        userId: true,
        createdAt: true,
        updatedAt: true,
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
        updatedBy: { select: { id: true, displayName: true } },
        transfers: {
          select: {
            id: true,
            fromClassId: true,
            toClassId: true,
            reason: true,
            transferredAt: true,
            fromClass: { select: { name: true } },
            toClass: { select: { name: true } },
            transferredBy: { select: { id: true, displayName: true } },
          },
          orderBy: { transferredAt: 'desc' },
        },
      },
    })

    if (!profile) throw new NotFoundException('学生档案不存在')

    const major = profile.class.parent
    const department = major?.parent ?? null

    return {
      id: profile.id,
      studentNo: profile.studentNo,
      name: profile.name,
      classId: profile.classId,
      className: profile.class.name,
      majorName: major?.name ?? null,
      departmentName: department?.name ?? null,
      enrollmentStatus: profile.enrollmentStatus,
      hasAccount: Boolean(profile.userId),
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
      updatedBy: profile.updatedBy,
      account:
        includeAccount && profile.userId
          ? await this.prisma.user.findUnique({
              where: { id: profile.userId },
              select: { id: true, displayName: true, email: true, status: true },
            })
          : null,
      transfers: profile.transfers.map((item) => ({
        id: item.id,
        fromClassId: item.fromClassId,
        fromClassName: item.fromClass.name,
        toClassId: item.toClassId,
        toClassName: item.toClass.name,
        reason: item.reason,
        transferredAt: item.transferredAt,
        transferredBy: item.transferredBy,
      })),
    }
  }

  /** 只允许修改姓名等基础信息 */
  async updateBasic(profileId: string, name: string, actorId: string) {
    await this.findById(profileId)

    return this.prisma.studentProfile.update({
      where: { id: profileId },
      data: { name: name.trim(), updatedById: actorId },
    })
  }

  /**
   * 转班
   *
   * 锁学生档案行 + 原/目标班级行，事务内写档案、历史并重算资格。
   * 转班后若旧班级的协管资格只来自学生身份，旧 UserRole 立即终止，
   * 不会因为“同专业班助候选”而自动保留。
   */
  async transfer(
    profileId: string,
    targetClassId: string,
    reason: string,
    actorId: string,
    expectedClassId?: string,
  ) {
    const normalizedReason = reason.trim()

    if (!normalizedReason) throw new BadRequestException('转班原因不能为空')
    if (normalizedReason.length > 255) throw new BadRequestException('转班原因不能超过 255 个字符')

    await assertOrganizationNode(this.organizationService, targetClassId, 'CLASS', '目标班级')

    const updated = await this.prisma.$transaction(async (tx) => {
      // 先锁学生记录，保证同一学生的并发转班串行执行
      await tx.$queryRaw`SELECT id FROM student_profiles WHERE id = ${profileId} FOR UPDATE`

      const profile = await tx.studentProfile.findUnique({
        where: { id: profileId },
        select: { id: true, userId: true, classId: true },
      })

      if (!profile) throw new NotFoundException('学生档案不存在')

      if (profile.classId === targetClassId) {
        throw new BadRequestException('学生已经在该班级，无需转班')
      }

      await lockClassRows(tx, [profile.classId, targetClassId])

      // 锁内重新读取，防止等待锁期间被其他事务改变
      const current = await tx.studentProfile.findUniqueOrThrow({
        where: { id: profileId },
        select: { classId: true, userId: true },
      })

      if (
        current.classId !== profile.classId ||
        (expectedClassId && current.classId !== expectedClassId)
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
          fromClassId: profile.classId,
          toClassId: targetClassId,
          reason: normalizedReason,
          transferredById: actorId,
        },
      })

      if (profile.userId) {
        await this.lifecycle.revokeStudentBasisIfOnly(profile.userId, profile.classId, actorId, tx)
      }

      return result
    })

    await this.lifecycle.invalidateMenus('student-profile.transfer')

    return updated
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

      await lockClassRows(tx, [profile.classId])

      const updated = await tx.studentProfile.update({
        where: { id: profileId },
        data: { enrollmentStatus, updatedById: actorId },
      })

      const removedRoles = profile.userId
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
