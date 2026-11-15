import { Injectable } from '@nestjs/common'

import type { Prisma } from '../../../generated/prisma/client.js'
import { MenuCacheInvalidatorService } from '../menus/menu-cache-invalidator.service.js'
import { CoordinatorEligibilityService } from './coordinator-eligibility.service.js'

/**
 * 协管员授权生命周期
 *
 * 资格失效时在同一事务内软撤销对应 UserRole：
 * - 只有「全部资格都失效」才撤销；
 * - 保留 revokedAt / revokedById 历史；
 * - 之后即使资格恢复，也不会重新激活旧分配，必须重新分配。
 *
 * 运行时过滤（PermissionService）仍是最终安全边界；
 * 这里的撤销用于让数据库状态与资格保持一致。
 */
@Injectable()
export class CoordinatorLifecycleService {
  constructor(
    private readonly eligibility: CoordinatorEligibilityService,
    private readonly menuCacheInvalidator: MenuCacheInvalidatorService,
  ) {}

  /**
   * 在事务内检查并撤销失去全部资格的协管员分配
   *
   * @returns 被撤销的 UserRole id 列表
   */
  async revokeIfIneligible(
    userId: string,
    classId: string,
    actorId: string,
    tx: Prisma.TransactionClient,
  ): Promise<string[]> {
    const role = await tx.role.findUnique({
      where: { code: 'CLASS_COORDINATOR' },
      select: { id: true },
    })

    if (!role) return []

    const assignment = await tx.userRole.findFirst({
      where: {
        userId,
        roleId: role.id,
        scopeOrgUnitId: classId,
        revokedAt: null,
      },
      select: { id: true },
    })

    if (!assignment) return []

    const result = await this.eligibility.evaluate(userId, classId, tx)

    if (result.eligible) return []

    const revoked = await tx.userRole.updateMany({
      where: { id: assignment.id, revokedAt: null },
      data: {
        revokedAt: new Date(),
        revokedById: actorId,
        revocationReason: 'QUALIFICATION_LOST',
      },
    })

    return revoked.count === 1 ? [assignment.id] : []
  }

  /**
   * 学生转班/离班时终止“仅靠学生身份”获得的旧班级协管员分配
   *
   * 现有资格规则中，同专业其他班学生也满足 CLASS_ASSISTANT 候选条件；
   * 若转班后只依赖这一点保留原班级角色，会与“不再实际担任原班级职务”冲突。
   * 因此在没有正式班长/班助任命表的情况下，只要该班级的资格全部来自学生身份，
   * 转班即终止旧分配，必须由管理员重新任命。
   */
  async revokeStudentBasisIfOnly(
    userId: string,
    classId: string,
    actorId: string,
    tx: Prisma.TransactionClient,
  ): Promise<string[]> {
    const role = await tx.role.findUnique({
      where: { code: 'CLASS_COORDINATOR' },
      select: { id: true },
    })

    if (!role) return []

    const assignment = await tx.userRole.findFirst({
      where: { userId, roleId: role.id, scopeOrgUnitId: classId, revokedAt: null },
      select: { id: true },
    })

    if (!assignment) return []

    const result = await this.eligibility.evaluate(userId, classId, tx)
    const studentOnly =
      result.bases.length > 0 &&
      result.bases.every((basis) => basis === 'STUDENT_MONITOR' || basis === 'CLASS_ASSISTANT')

    if (!studentOnly) return []

    const revoked = await tx.userRole.updateMany({
      where: { id: assignment.id, revokedAt: null },
      data: {
        revokedAt: new Date(),
        revokedById: actorId,
        revocationReason: 'QUALIFICATION_LOST',
      },
    })

    return revoked.count === 1 ? [assignment.id] : []
  }

  /** 事务提交后提升菜单缓存 generation */
  async invalidateMenus(reason: string): Promise<void> {
    await this.menuCacheInvalidator.invalidate(reason)
  }
}
