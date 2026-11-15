import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'

import { PrismaService } from '../../prisma/prisma.service.js'
import { OrganizationService } from '../rbac/organizations/organization.service.js'
import { CoordinatorActorPolicy } from './coordinator-actor-policy.service.js'
import { hasOverlap, lockClassRows } from './coordinator-concurrency.js'
import { CoordinatorLifecycleService } from './coordinator-lifecycle.service.js'
import { assertOrganizationNode, assertValidWindow } from './profile-validation.js'

export interface AssignTeacherClassDutyInput {
  teacherId: string
  classId: string
  validFrom?: Date
  validUntil?: Date | null
}

/**
 * 教师班级职责（班主任）
 *
 * 并发安全：
 * 1. 对目标班级行 SELECT ... FOR UPDATE；
 * 2. 在锁内重新读取同教师同班级的有效任职；
 * 3. 使用半开区间 [validFrom, min(validUntil, revokedAt)) 检查重叠；
 * 4. 创建任职并在同一事务内做协管员资格重算。
 *
 * 不设永久唯一约束：离任后可再次担任，历史记录永不删除。
 */
@Injectable()
export class TeacherClassDutyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizationService: OrganizationService,
    private readonly lifecycle: CoordinatorLifecycleService,
    private readonly actorPolicy: CoordinatorActorPolicy,
  ) {}

  async assign(input: AssignTeacherClassDutyInput, actorId: string) {
    const validFrom = input.validFrom ?? new Date()
    const validUntil = input.validUntil ?? null

    assertValidWindow(validFrom, validUntil)

    await assertOrganizationNode(this.organizationService, input.classId, 'CLASS', '任职班级')

    await this.actorPolicy.assertAllowed(
      actorId,
      input.classId,
      ['SCHOOL_ADMIN', 'DEPARTMENT_ADMIN'],
      '只有学校或院系管理员可以维护班主任任职',
    )

    const created = await this.prisma.$transaction(async (tx) => {
      await lockClassRows(tx, [input.classId])

      // 教师身份挂在工作人员档案下，账号通过 personnelProfile.userId 取得
      const teacher = await tx.teacherProfile.findUnique({
        where: { id: input.teacherId },
        select: {
          id: true,
          status: true,
          personnelProfile: { select: { userId: true } },
        },
      })

      if (!teacher) throw new NotFoundException('教师档案不存在')

      if (teacher.status !== 'ACTIVE') {
        throw new BadRequestException('教师当前不在职，不能担任班主任')
      }

      /**
       * 新增资格前先终止已失去依据的旧分配：
       * 自然到期不会写数据库，若此时直接新增任职，旧 UserRole 可能被重新激活。
       */
      await this.lifecycle.revokeIfIneligible(
        teacher.personnelProfile.userId,
        input.classId,
        actorId,
        tx,
      )

      const existing = await tx.teacherClassDuty.findMany({
        where: {
          teacherId: input.teacherId,
          classId: input.classId,
          dutyType: 'HEAD_TEACHER',
        },
        select: { validFrom: true, validUntil: true, revokedAt: true },
      })

      if (hasOverlap({ validFrom, validUntil }, existing)) {
        throw new ConflictException('该时间段内已存在相同的班主任任职')
      }

      return tx.teacherClassDuty.create({
        data: {
          teacherId: input.teacherId,
          classId: input.classId,
          validFrom,
          validUntil,
          assignedById: actorId,
        },
      })
    })

    await this.lifecycle.invalidateMenus('coordinator.duty.create')

    return created
  }

  async revoke(dutyId: string, actorId: string) {
    const revoked = await this.prisma.$transaction(async (tx) => {
      const duty = await tx.teacherClassDuty.findUnique({
        where: { id: dutyId },
        include: { teacher: { select: { personnelProfile: { select: { userId: true } } } } },
      })

      if (!duty) throw new NotFoundException('班主任任职记录不存在')
      if (duty.revokedAt) throw new ConflictException('该任职记录已结束')

      await this.actorPolicy.assertAllowed(
        actorId,
        duty.classId,
        ['SCHOOL_ADMIN', 'DEPARTMENT_ADMIN'],
        '只有学校或院系管理员可以撤销班主任任职',
      )

      await lockClassRows(tx, [duty.classId])

      const result = await tx.teacherClassDuty.updateMany({
        where: { id: dutyId, revokedAt: null },
        data: { revokedAt: new Date(), revokedById: actorId },
      })

      if (result.count !== 1) throw new ConflictException('该任职记录已结束')

      const removedRoles = await this.lifecycle.revokeIfIneligible(
        duty.teacher.personnelProfile.userId,
        duty.classId,
        actorId,
        tx,
      )

      return {
        duty: await tx.teacherClassDuty.findUniqueOrThrow({ where: { id: dutyId } }),
        removedRoles,
      }
    })

    await this.lifecycle.invalidateMenus('coordinator.duty.revoke')

    return revoked.duty
  }

  /** 管理列表：按授权班级范围分页查询，支持状态/教师/班级/职责类型过滤 */
  async listPaged(params: {
    classIds: string[]
    teacherId?: string
    classId?: string
    dutyType?: 'HEAD_TEACHER'
    status: 'EFFECTIVE' | 'REVOKED' | 'ALL'
    page: number
    pageSize: number
  }) {
    const now = new Date()
    const where = {
      classId: { in: params.classId ? [params.classId] : params.classIds },
      ...(params.teacherId ? { teacherId: params.teacherId } : {}),
      ...(params.dutyType ? { dutyType: params.dutyType } : {}),
      ...(params.status === 'REVOKED'
        ? { revokedAt: { not: null } }
        : params.status === 'EFFECTIVE'
          ? {
              revokedAt: null,
              validFrom: { lte: now },
              OR: [{ validUntil: null }, { validUntil: { gt: now } }],
            }
          : {}),
    }

    const [total, list] = await Promise.all([
      this.prisma.teacherClassDuty.count({ where }),
      this.prisma.teacherClassDuty.findMany({
        where,
        select: {
          id: true,
          teacherId: true,
          classId: true,
          dutyType: true,
          validFrom: true,
          validUntil: true,
          revokedAt: true,
          revokedById: true,
          teacher: {
            select: {
              teacherNo: true,
              personnelProfile: {
                select: { user: { select: { realName: true, email: true } } },
              },
            },
          },
          class: { select: { id: true, name: true, code: true } },
        },
        orderBy: [{ validFrom: 'desc' }, { id: 'desc' }],
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
    ])

    return {
      total,
      list: list.map((item) => ({
        id: item.id,
        teacherId: item.teacherId,
        teacherNo: item.teacher.teacherNo,
        teacherName: item.teacher.personnelProfile.user.realName,
        teacherEmail: item.teacher.personnelProfile.user.email,
        classId: item.classId,
        className: item.class.name,
        classCode: item.class.code,
        dutyType: item.dutyType,
        validFrom: item.validFrom,
        validUntil: item.validUntil,
        revokedAt: item.revokedAt,
        revokedById: item.revokedById,
        isEffective:
          item.revokedAt === null &&
          item.validFrom.getTime() <= now.getTime() &&
          (!item.validUntil || item.validUntil.getTime() > now.getTime()),
      })),
    }
  }

  async findDetail(dutyId: string) {
    const duty = await this.prisma.teacherClassDuty.findUnique({
      where: { id: dutyId },
      select: {
        id: true,
        teacherId: true,
        classId: true,
        dutyType: true,
        validFrom: true,
        validUntil: true,
        revokedAt: true,
        revokedById: true,
        teacher: {
          select: {
            teacherNo: true,
            personnelProfile: {
              select: { user: { select: { realName: true, email: true } } },
            },
          },
        },
        class: { select: { id: true, name: true, code: true } },
      },
    })

    if (!duty) throw new NotFoundException('班主任任职记录不存在')

    const now = new Date()

    return {
      id: duty.id,
      teacherId: duty.teacherId,
      teacherNo: duty.teacher.teacherNo,
      teacherName: duty.teacher.personnelProfile.user.realName,
      teacherEmail: duty.teacher.personnelProfile.user.email,
      classId: duty.classId,
      className: duty.class.name,
      classCode: duty.class.code,
      dutyType: duty.dutyType,
      validFrom: duty.validFrom,
      validUntil: duty.validUntil,
      revokedAt: duty.revokedAt,
      revokedById: duty.revokedById,
      isEffective:
        duty.revokedAt === null &&
        duty.validFrom.getTime() <= now.getTime() &&
        (!duty.validUntil || duty.validUntil.getTime() > now.getTime()),
    }
  }

  /** 默认只返回当前有效的任职（未撤销、已生效、未过期） */
  async listByClass(classId: string, includeRevoked = false) {
    return this.prisma.teacherClassDuty.findMany({
      where: { classId, ...this.effectiveWhere(includeRevoked) },
      include: {
        teacher: {
          include: {
            personnelProfile: {
              include: { user: { select: { id: true, realName: true, email: true } } },
            },
          },
        },
      },
      orderBy: { validFrom: 'desc' },
    })
  }

  async listByTeacher(teacherId: string, includeRevoked = false) {
    return this.prisma.teacherClassDuty.findMany({
      where: { teacherId, ...this.effectiveWhere(includeRevoked) },
      orderBy: { validFrom: 'desc' },
    })
  }

  private effectiveWhere(includeRevoked: boolean) {
    if (includeRevoked) return {}

    const now = new Date()

    return {
      revokedAt: null,
      validFrom: { lte: now },
      OR: [{ validUntil: null }, { validUntil: { gt: now } }],
    }
  }
}
