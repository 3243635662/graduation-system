import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'

import { PrismaService } from '../../prisma/prisma.service.js'
import { OrganizationService } from '../rbac/organizations/organization.service.js'
import { hasOverlap, lockClassRows } from './coordinator-concurrency.js'
import { CoordinatorLifecycleService } from './coordinator-lifecycle.service.js'
import { assertOrganizationNode, assertUsableUser } from './profile-validation.js'

export interface CreateCoordinatorOverrideInput {
  userId: string
  classId: string
  reason: string
  validUntil?: Date | null
}

/**
 * 协管员资格特殊覆盖
 *
 * 仅有效的 SCHOOL_ADMIN 可以创建，且必须：
 * - 目标班级位于其学校范围；
 * - reason 非空；
 * - 与对应 CLASS_COORDINATOR UserRole 在同一事务中创建。
 *
 * 普通管理员没有接口路径可以设置 override 绕过资格校验。
 */
@Injectable()
export class CoordinatorOverrideService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizationService: OrganizationService,
    private readonly lifecycle: CoordinatorLifecycleService,
  ) {}

  async create(input: CreateCoordinatorOverrideInput, actorId: string) {
    const reason = input.reason.trim()

    if (!reason) throw new BadRequestException('特殊覆盖必须填写授权原因')

    await assertOrganizationNode(this.organizationService, input.classId, 'CLASS', '目标班级')
    await assertUsableUser(this.prisma, input.userId)
    await this.assertSchoolAdmin(actorId, input.classId)

    const validUntil = input.validUntil ?? null

    if (validUntil && validUntil.getTime() <= Date.now()) {
      throw new BadRequestException('覆盖授权有效期必须晚于当前时间')
    }

    const created = await this.prisma.$transaction(async (tx) => {
      await lockClassRows(tx, [input.classId])

      // 覆盖授权属于新增资格：先终止已失效但仍未撤销的旧分配
      await this.lifecycle.revokeIfIneligible(input.userId, input.classId, actorId, tx)

      const existing = await tx.coordinatorQualificationOverride.findMany({
        where: { userId: input.userId, classId: input.classId },
        select: { validFrom: true, validUntil: true, revokedAt: true },
      })

      if (hasOverlap({ validFrom: new Date(), validUntil }, existing)) {
        throw new ConflictException('该时间段内已存在相同的特殊覆盖授权')
      }

      const override = await tx.coordinatorQualificationOverride.create({
        data: {
          userId: input.userId,
          classId: input.classId,
          reason,
          grantedById: actorId,
          validUntil,
        },
      })

      await this.lifecycle.ensureClassCoordinatorRole(
        input.userId,
        input.classId,
        actorId,
        override.validFrom,
        tx,
      )

      return override
    })

    await this.lifecycle.invalidateMenus('coordinator.override.create')

    return created
  }

  async revoke(overrideId: string, actorId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const override = await tx.coordinatorQualificationOverride.findUnique({
        where: { id: overrideId },
      })

      if (!override) throw new NotFoundException('特殊覆盖授权不存在')
      if (override.revokedAt) throw new ConflictException('该特殊覆盖授权已撤销')

      await this.assertSchoolAdmin(actorId, override.classId)
      await lockClassRows(tx, [override.classId])

      const updated = await tx.coordinatorQualificationOverride.updateMany({
        where: { id: overrideId, revokedAt: null },
        data: { revokedAt: new Date(), revokedById: actorId },
      })

      if (updated.count !== 1) throw new ConflictException('该特殊覆盖授权已撤销')

      await this.lifecycle.revokeIfIneligible(override.userId, override.classId, actorId, tx)

      return tx.coordinatorQualificationOverride.findUniqueOrThrow({
        where: { id: overrideId },
      })
    })

    await this.lifecycle.invalidateMenus('coordinator.override.revoke')

    return result
  }

  async findById(overrideId: string) {
    const override = await this.prisma.coordinatorQualificationOverride.findUnique({
      where: { id: overrideId },
      select: { id: true, classId: true, userId: true },
    })

    if (!override) throw new NotFoundException('特殊覆盖授权不存在')

    return override
  }

  /** 学校管理员分页查询授权范围内的覆盖历史 */
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
      this.prisma.coordinatorQualificationOverride.count({ where }),
      this.prisma.coordinatorQualificationOverride.findMany({
        where,
        include: {
          user: { select: { id: true, realName: true, email: true } },
          class: { select: { id: true, name: true, code: true } },
          grantedBy: { select: { id: true, realName: true } },
          revokedBy: { select: { id: true, realName: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
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
        classId: item.classId,
        className: item.class.name,
        classCode: item.class.code,
        reason: item.reason,
        validFrom: item.validFrom,
        validUntil: item.validUntil,
        revokedAt: item.revokedAt,
        revokedById: item.revokedById,
        revokedByName: item.revokedBy?.realName ?? null,
        grantedById: item.grantedById,
        grantedByName: item.grantedBy.realName,
        isEffective:
          item.revokedAt === null &&
          item.validFrom.getTime() <= now.getTime() &&
          (!item.validUntil || item.validUntil.getTime() > now.getTime()),
      })),
    }
  }

  async list(query: { userId?: string; classId?: string; includeRevoked?: boolean }) {
    const now = new Date()

    return this.prisma.coordinatorQualificationOverride.findMany({
      where: {
        ...(query.userId ? { userId: query.userId } : {}),
        ...(query.classId ? { classId: query.classId } : {}),
        ...(query.includeRevoked
          ? {}
          : {
              revokedAt: null,
              validFrom: { lte: now },
              OR: [{ validUntil: null }, { validUntil: { gt: now } }],
            }),
      },
      include: {
        user: { select: { id: true, realName: true, email: true } },
        grantedBy: { select: { id: true, realName: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
  }

  /** 只有有效的 SCHOOL_ADMIN，且目标班级在其学校范围内 */
  private async assertSchoolAdmin(actorId: string, classId: string): Promise<void> {
    const now = new Date()

    // UserRole 仅保存当前授权，撤销即删除，因此不再需要 revokedAt 过滤
    const assignments = await this.prisma.userRole.findMany({
      where: {
        userId: actorId,
        validFrom: { lte: now },
        OR: [{ validUntil: null }, { validUntil: { gt: now } }],
        role: { code: 'SCHOOL_ADMIN', status: 'ACTIVE' },
        scopeOrgUnitId: { not: null },
      },
      select: { scopeOrgUnitId: true },
    })

    for (const assignment of assignments) {
      if (!assignment.scopeOrgUnitId) continue

      if (!(await this.organizationService.isPathActive(assignment.scopeOrgUnitId))) continue

      if (await this.organizationService.isWithinScope(classId, assignment.scopeOrgUnitId)) {
        return
      }
    }

    throw new ForbiddenException({
      code: 40300,
      data: null,
      message: '只有学校管理员可以在本校范围内执行特殊覆盖授权',
    })
  }
}
