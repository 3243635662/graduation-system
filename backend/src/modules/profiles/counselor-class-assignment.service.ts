import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'

import { PrismaService } from '../../prisma/prisma.service.js'
import { OrganizationService } from '../rbac/organizations/organization.service.js'
import { CoordinatorActorPolicy } from './coordinator-actor-policy.service.js'
import { hasOverlap, lockClassRows } from './coordinator-concurrency.js'
import { CoordinatorLifecycleService } from './coordinator-lifecycle.service.js'
import {
  assertOrganizationNode,
  assertUsableUser,
  assertValidWindow,
} from './profile-validation.js'

export interface AssignCounselorInput {
  userId: string
  classId: string
  validFrom?: Date
  validUntil?: Date | null
}

/**
 * 辅导员班级分配
 *
 * 同一 user + class 不允许时间重叠；一个辅导员可负责多个班级，
 * 一个班级可有多名辅导员。并发写操作统一锁定班级行。
 */
@Injectable()
export class CounselorClassAssignmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizationService: OrganizationService,
    private readonly lifecycle: CoordinatorLifecycleService,
    private readonly actorPolicy: CoordinatorActorPolicy,
  ) {}

  async assign(input: AssignCounselorInput, actorId: string) {
    const validFrom = input.validFrom ?? new Date()
    const validUntil = input.validUntil ?? null

    assertValidWindow(validFrom, validUntil)

    await assertUsableUser(this.prisma, input.userId, '辅导员账号')
    await assertOrganizationNode(this.organizationService, input.classId, 'CLASS', '负责班级')

    await this.actorPolicy.assertAllowed(
      actorId,
      input.classId,
      ['SCHOOL_ADMIN', 'DEPARTMENT_ADMIN'],
      '只有学校或院系管理员可以维护辅导员分配',
    )

    const created = await this.prisma.$transaction(async (tx) => {
      await lockClassRows(tx, [input.classId])

      // 新增资格前终止自然到期后残留的旧分配，避免之后被重新激活
      await this.lifecycle.revokeIfIneligible(input.userId, input.classId, actorId, tx)

      const existing = await tx.counselorClassAssignment.findMany({
        where: { userId: input.userId, classId: input.classId },
        select: { validFrom: true, validUntil: true, revokedAt: true },
      })

      if (hasOverlap({ validFrom, validUntil }, existing)) {
        throw new ConflictException('该时间段内已存在相同的辅导员分配')
      }

      return tx.counselorClassAssignment.create({
        data: {
          userId: input.userId,
          classId: input.classId,
          validFrom,
          validUntil,
          assignedById: actorId,
        },
      })
    })

    await this.lifecycle.invalidateMenus('coordinator.counselor.create')

    return created
  }

  async revoke(assignmentId: string, actorId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const assignment = await tx.counselorClassAssignment.findUnique({
        where: { id: assignmentId },
      })

      if (!assignment) throw new NotFoundException('辅导员分配记录不存在')
      if (assignment.revokedAt) throw new ConflictException('该辅导员分配已结束')

      await this.actorPolicy.assertAllowed(
        actorId,
        assignment.classId,
        ['SCHOOL_ADMIN', 'DEPARTMENT_ADMIN'],
        '只有学校或院系管理员可以撤销辅导员分配',
      )

      await lockClassRows(tx, [assignment.classId])

      const updated = await tx.counselorClassAssignment.updateMany({
        where: { id: assignmentId, revokedAt: null },
        data: { revokedAt: new Date(), revokedById: actorId },
      })

      if (updated.count !== 1) throw new ConflictException('该辅导员分配已结束')

      const removedRoles = await this.lifecycle.revokeIfIneligible(
        assignment.userId,
        assignment.classId,
        actorId,
        tx,
      )

      return {
        assignment: await tx.counselorClassAssignment.findUniqueOrThrow({
          where: { id: assignmentId },
        }),
        removedRoles,
      }
    })

    await this.lifecycle.invalidateMenus('coordinator.counselor.revoke')

    return result.assignment
  }

  async findById(assignmentId: string) {
    const assignment = await this.prisma.counselorClassAssignment.findUnique({
      where: { id: assignmentId },
      select: { id: true, classId: true, userId: true },
    })

    if (!assignment) throw new NotFoundException('辅导员分配记录不存在')

    return assignment
  }

  /** 管理列表：按授权班级范围分页查询 */
  async listPaged(params: {
    classIds: string[]
    userId?: string
    classId?: string
    status: 'EFFECTIVE' | 'REVOKED' | 'ALL'
    page: number
    pageSize: number
  }) {
    const now = new Date()
    const where = {
      classId: { in: params.classId ? [params.classId] : params.classIds },
      ...(params.userId ? { userId: params.userId } : {}),
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
      this.prisma.counselorClassAssignment.count({ where }),
      this.prisma.counselorClassAssignment.findMany({
        where,
        include: {
          user: { select: { id: true, realName: true, email: true, status: true } },
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
        userId: item.userId,
        userName: item.user.realName,
        userEmail: item.user.email,
        userStatus: item.user.status,
        classId: item.classId,
        className: item.class.name,
        classCode: item.class.code,
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

  async listByClass(classId: string, includeRevoked = false) {
    return this.prisma.counselorClassAssignment.findMany({
      where: { classId, ...this.effectiveWhere(includeRevoked) },
      include: { user: { select: { id: true, realName: true, email: true } } },
      orderBy: { validFrom: 'desc' },
    })
  }

  async listByUser(userId: string, includeRevoked = false) {
    return this.prisma.counselorClassAssignment.findMany({
      where: { userId, ...this.effectiveWhere(includeRevoked) },
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
