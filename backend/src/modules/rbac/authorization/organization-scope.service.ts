import { ForbiddenException, Injectable } from '@nestjs/common'

import type { DataScope } from '../../../../generated/prisma/client.js'
import { OrganizationService } from '../organizations/organization.service.js'
import { PermissionService } from './permission.service.js'

/**
 * 组织数据范围
 *
 * - ALL     ：GLOBAL 范围（仅技术管理角色可能拥有），不做组织过滤
 * - SUBTREE ：一个或多个组织子树，取并集
 * - NONE    ：没有任何可用的组织范围，必须拒绝
 */
export type OrganizationScope =
  | { kind: 'ALL' }
  | { kind: 'SUBTREE'; orgUnitIds: string[] }
  | { kind: 'NONE' }

/** Prisma where 片段：仅命中允许的组织节点 */
export interface OrganizationUnitFilter {
  id: { in: string[] }
}

/** ASSIGNED / SELF 通过业务关系确定范围，不产生组织子树 */
function isOrgScoped(dataScope: DataScope): boolean {
  return (
    dataScope === 'SCHOOL' ||
    dataScope === 'DEPARTMENT' ||
    dataScope === 'MAJOR' ||
    dataScope === 'CLASS'
  )
}

export function organizationForbidden(
  message = '没有访问该组织范围数据的权限',
): ForbiddenException {
  return new ForbiddenException({ code: 40300, data: null, message })
}

/**
 * 组织范围解析
 *
 * 严格按「权限 + 角色分配」成对计算：
 * 只取真正授予了该权限的角色分配，再按每条分配的范围求并集。
 * 绝不把用户所有角色的数据范围无条件合并。
 */
@Injectable()
export class OrganizationScopeService {
  constructor(
    private readonly permissionService: PermissionService,
    private readonly organizationService: OrganizationService,
  ) {}

  /**
   * 计算某个功能权限对应的组织范围
   *
   * includeDisabledDescendants 仅用于「修改/启用」类操作：
   * 停用的节点必须仍然可被上级管理员看到并重新启用，
   * 但它绝不会扩大读取或业务访问范围。
   */
  async resolve(
    userId: string,
    permissionCode: string,
    options: { includeDisabledDescendants?: boolean } = {},
  ): Promise<OrganizationScope> {
    const assignments = await this.permissionService.findPermissionAssignments(
      userId,
      permissionCode,
    )

    if (assignments.length === 0) return { kind: 'NONE' }

    const orgUnitIds = new Set<string>()
    let global = false

    for (const assignment of assignments) {
      if (assignment.dataScope === 'GLOBAL') {
        global = true

        continue
      }

      if (!isOrgScoped(assignment.dataScope)) continue
      if (!assignment.scopeOrgUnitId) continue

      const subtreeIds = options.includeDisabledDescendants
        ? await this.organizationService.getManageableSubtreeIds(assignment.scopeOrgUnitId)
        : await this.organizationService.getSubtreeIds(assignment.scopeOrgUnitId)

      for (const id of subtreeIds) orgUnitIds.add(id)
    }

    // GLOBAL 已经覆盖全部组织，无需继续合并子树
    if (global) return { kind: 'ALL' }
    if (orgUnitIds.size === 0) return { kind: 'NONE' }

    return { kind: 'SUBTREE', orgUnitIds: [...orgUnitIds] }
  }

  /** 列表查询条件：ALL 不加过滤，其余必须真正落到 SQL 条件里（失败关闭） */
  async buildOrgUnitFilter(
    userId: string,
    permissionCode: string,
  ): Promise<OrganizationUnitFilter | undefined> {
    const scope = await this.resolve(userId, permissionCode)

    if (scope.kind === 'ALL') return undefined
    if (scope.kind === 'NONE') throw organizationForbidden()

    return { id: { in: scope.orgUnitIds } }
  }

  /** 单节点访问校验：目标必须落在允许范围内 */
  async assertOrgUnitAccess(
    userId: string,
    permissionCode: string,
    orgUnitId: string,
    options: { includeDisabledDescendants?: boolean } = {},
  ): Promise<void> {
    const scope = await this.resolve(userId, permissionCode, options)

    if (scope.kind === 'ALL') return

    if (scope.kind === 'NONE' || !scope.orgUnitIds.includes(orgUnitId)) {
      throw organizationForbidden()
    }
  }
}
