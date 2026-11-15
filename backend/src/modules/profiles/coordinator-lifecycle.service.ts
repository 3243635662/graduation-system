import { Injectable } from '@nestjs/common'

import type { Prisma, UserRoleRevocationReason } from '../../../generated/prisma/client.js'
import { MenuCacheInvalidatorService } from '../menus/menu-cache-invalidator.service.js'
import { CoordinatorEligibilityService } from './coordinator-eligibility.service.js'

const ROLE_CLASS_COORDINATOR = 'CLASS_COORDINATOR'

/**
 * 协管员授权生命周期
 *
 * Phase 1 起角色授权采用「当前表 + 历史表」：
 * - UserRole 只保存此刻有效的授权，撤销即删除该行；
 * - UserRoleHistory 追加一条不可变快照，保留撤销原因与操作人；
 * - 之后即使资格恢复，也不会自动重建授权，必须由管理员重新分配。
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
      where: { code: ROLE_CLASS_COORDINATOR },
      select: { id: true, code: true },
    })

    if (!role) return []

    const assignment = await tx.userRole.findFirst({
      where: { userId, roleId: role.id, scopeOrgUnitId: classId },
    })

    if (!assignment) return []

    const result = await this.eligibility.evaluate(userId, classId, tx)

    if (result.eligible) return []

    await this.revokeAssignment(assignment, role, actorId, 'QUALIFICATION_LOST', tx)

    return [assignment.id]
  }

  /**
   * 学生转班/离班时终止「仅靠本班学生身份」获得的旧班级协管员分配
   *
   * 任务书规定学生只能协管本人当前班级；转班后原班级资格随之消失，
   * 因此旧分配必须终止，由管理员按新班级重新任命。
   */
  async revokeStudentBasisIfOnly(
    userId: string,
    classId: string,
    actorId: string,
    tx: Prisma.TransactionClient,
  ): Promise<string[]> {
    const role = await tx.role.findUnique({
      where: { code: ROLE_CLASS_COORDINATOR },
      select: { id: true, code: true },
    })

    if (!role) return []

    const assignment = await tx.userRole.findFirst({
      where: { userId, roleId: role.id, scopeOrgUnitId: classId },
    })

    if (!assignment) return []

    const result = await this.eligibility.evaluate(userId, classId, tx)
    /**
     * 只处理「依据仅来自本班学生身份」的情况；
     * 完全没有资格的场景由 revokeIfIneligible 负责。
     *
     * 调用方（转班事务）必须在更新 classId 之前调用本方法，
     * 否则档案已指向新班级，旧班级的学生依据将不可见。
     */
    const studentOnly =
      result.bases.length > 0 && result.bases.every((basis) => basis === 'STUDENT_SELF')

    if (!studentOnly) return []

    await this.revokeAssignment(assignment, role, actorId, 'QUALIFICATION_LOST', tx)

    return [assignment.id]
  }

  /**
   * 撤销一条当前授权：先写历史快照，再删除当前行。
   *
   * 顺序固定为「先历史后删除」，保证任何时刻都能通过历史表追溯已撤销的授权。
   */
  private async revokeAssignment(
    assignment: {
      id: string
      userId: string
      scopeOrgUnitId: string | null
      scopeKey: string
      assignedById: string | null
      validFrom: Date
      validUntil: Date | null
    },
    role: { id: string; code: string },
    actorId: string,
    reason: UserRoleRevocationReason,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await tx.userRoleHistory.create({
      data: {
        userRoleId: assignment.id,
        userId: assignment.userId,
        roleId: role.id,
        roleCode: role.code,
        scopeOrgUnitId: assignment.scopeOrgUnitId,
        scopeKey: assignment.scopeKey,
        assignedById: assignment.assignedById,
        validFrom: assignment.validFrom,
        validUntil: assignment.validUntil,
        revokedAt: new Date(),
        revokedById: actorId,
        revocationReason: reason,
      },
    })

    await tx.userRole.delete({ where: { id: assignment.id } })
  }

  /** 事务提交后提升菜单缓存 generation */
  async invalidateMenus(reason: string): Promise<void> {
    await this.menuCacheInvalidator.invalidate(reason)
  }
}
