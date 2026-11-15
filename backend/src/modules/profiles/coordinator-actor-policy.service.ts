import { ForbiddenException, Injectable } from '@nestjs/common'

import { PrismaService } from '../../prisma/prisma.service.js'
import { OrganizationService } from '../rbac/organizations/organization.service.js'

/**
 * 协管员相关操作的执行人校验
 *
 * 与功能权限 Guard 互补：
 * - Guard 判断「是否拥有角色分配类权限」；
 * - 本服务判断「操作人的角色模板与组织范围是否覆盖目标班级」。
 *
 * 所有判断都来自数据库中的有效 UserRole，客户端参数无法绕过。
 */
@Injectable()
export class CoordinatorActorPolicy {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizationService: OrganizationService,
  ) {}

  async assertAllowed(
    actorId: string,
    classId: string,
    allowedRoleCodes: string[],
    message: string,
  ): Promise<void> {
    const now = new Date()

    const assignments = await this.prisma.userRole.findMany({
      where: {
        userId: actorId,
        revokedAt: null,
        validFrom: { lte: now },
        OR: [{ validUntil: null }, { validUntil: { gt: now } }],
        scopeOrgUnitId: { not: null },
        role: { code: { in: allowedRoleCodes }, status: 'ACTIVE' },
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

    throw new ForbiddenException({ code: 40300, data: null, message })
  }
}
