import { MenuType } from '@graduation/shared'
import type { MenuTreeNode } from '@graduation/shared'
import { Injectable, Logger } from '@nestjs/common'

import { PrismaService } from '../../prisma/prisma.service.js'
import { PermissionService } from '../rbac/authorization/permission.service.js'
import { OrganizationService } from '../rbac/organizations/organization.service.js'
import { MenuCacheService } from './menu-cache.service.js'
import type { MenuQueryRow } from './types/menu-cache.type.js'

/** 查询菜单时只取渲染与建树需要的字段 */
const MENU_SELECT = {
  id: true,
  code: true,
  title: true,
  path: true,
  componentKey: true,
  icon: true,
  type: true,
  parentId: true,
  sortOrder: true,
  visible: true,
  status: true,
} as const

const ACTIVE = 'ACTIVE'
const DIRECTORY = 'DIRECTORY'
const PAGE = 'PAGE'

/**
 * 同级排序：sortOrder 升序，其次按 code 码点升序
 *
 * 使用码点比较而不是 localeCompare：排序结果会写入 Redis 并被多实例共享，
 * 不能依赖运行环境的 ICU/区域设置。
 */
function compareNodes(a: MenuQueryRow, b: MenuQueryRow): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
  if (a.code === b.code) return 0

  return a.code < b.code ? -1 : 1
}

function isActiveMenu(row: MenuQueryRow): boolean {
  return row.status === ACTIVE
}

/**
 * 由数据库行构建菜单树
 *
 * 规则：
 * 1. 只有 PAGE 才可能成为返回的叶子页面，且必须同时具备 path 与 componentKey。
 * 2. DIRECTORY 只作为祖先节点补齐，且只保留「至少有一个合法 PAGE 后代」的目录。
 * 3. 停用（status != ACTIVE）的节点被丢弃；祖先链上有停用节点的页面一并丢弃，
 *    避免「目录被停用但子页面仍以根节点身份出现」的越权观感。
 * 4. 只补齐祖先，不因为补齐而扩大 PAGE 授权。
 * 5. 以 visited 集合防止循环引用导致无限递归。
 */
export function buildMenuTree(rows: MenuQueryRow[], logger?: Logger): MenuTreeNode[] {
  const byId = new Map<string, MenuQueryRow>()

  for (const row of rows) {
    if (!byId.has(row.id)) byId.set(row.id, row)
  }

  /** 祖先链上存在停用节点，或存在循环引用时，判定该节点不可用 */
  const hasBrokenAncestorChain = (row: MenuQueryRow): boolean => {
    const seen = new Set<string>([row.id])
    let cursor = row.parentId

    while (cursor) {
      if (seen.has(cursor)) {
        logger?.error(`菜单存在循环引用（出现于 ${row.code} 的祖先链），已跳过该节点`)

        return true
      }

      seen.add(cursor)

      const parent = byId.get(cursor)

      // 祖先未加载（超出 RoleMenu 与祖先补齐范围）时按根节点处理
      if (!parent) return false

      if (!isActiveMenu(parent)) return true

      cursor = parent.parentId
    }

    return false
  }

  /** 授权页面：必须是 ACTIVE 的 PAGE，且具备可路由的 path + componentKey */
  const pages: MenuQueryRow[] = []

  for (const row of rows) {
    if (row.type !== PAGE) continue
    if (!isActiveMenu(row)) continue
    if (hasBrokenAncestorChain(row)) continue

    if (!row.path || !row.componentKey) {
      // 允许存在「占位页面」，但不能把它当成合法业务页面注册路由
      logger?.error(
        `菜单 ${row.code} 是 PAGE 但缺少 ${!row.path ? 'path' : 'componentKey'}，已从结果中排除`,
      )

      continue
    }

    pages.push(row)
  }

  if (pages.length === 0) return []

  // 授权页面 + 必要祖先目录（去重，全部按 id）
  const kept = new Map<string, MenuQueryRow>()

  for (const page of pages) {
    kept.set(page.id, page)

    let cursor = page.parentId
    const seen = new Set<string>([page.id])

    while (cursor) {
      if (seen.has(cursor)) break

      seen.add(cursor)

      const parent = byId.get(cursor)

      if (!parent) break
      if (!isActiveMenu(parent)) break
      // 只补齐目录，不把任何 PAGE 祖先当作分组节点
      if (parent.type !== DIRECTORY) break

      kept.set(parent.id, parent)
      cursor = parent.parentId
    }
  }

  const keptRows = [...kept.values()]

  /**
   * 实际渲染父级
   *
   * 只有「父节点被保留且确实是 DIRECTORY」时才算有父级，否则一律按根节点处理。
   * 这样输出里不会出现「根节点却带着不在结果集中的 parentId」，也不会把 PAGE 当分组。
   */
  const effectiveParentId = new Map<string, string | null>()

  for (const row of keptRows) {
    const parent = row.parentId ? kept.get(row.parentId) : undefined

    effectiveParentId.set(row.id, parent && parent.type === DIRECTORY ? parent.id : null)
  }

  const childrenByParent = new Map<string, MenuQueryRow[]>()

  for (const row of keptRows) {
    const parentId = effectiveParentId.get(row.id)

    if (!parentId) continue

    const siblings = childrenByParent.get(parentId)

    if (siblings) siblings.push(row)
    else childrenByParent.set(parentId, [row])
  }

  const visited = new Set<string>()

  const toNode = (row: MenuQueryRow): MenuTreeNode | null => {
    if (visited.has(row.id)) {
      logger?.error(`菜单 ${row.code} 重复出现（可能存在循环引用），已跳过`)

      return null
    }

    visited.add(row.id)

    const children = (childrenByParent.get(row.id) ?? [])
      .toSorted(compareNodes)
      .map(toNode)
      .filter((child): child is MenuTreeNode => child !== null)

    // 目录必须至少有一个可见后代，否则不返回空目录
    if (row.type === DIRECTORY && children.length === 0) return null

    return {
      id: row.id,
      // parentId 表示「渲染树中的实际父级」，与 roots / children 的判定完全一致
      parentId: effectiveParentId.get(row.id) ?? null,
      code: row.code,
      title: row.title,
      path: row.path,
      type: row.type === DIRECTORY ? MenuType.DIRECTORY : MenuType.PAGE,
      icon: row.icon ?? undefined,
      componentKey: row.componentKey ?? undefined,
      sortOrder: row.sortOrder,
      visible: row.visible,
      children: children.length > 0 ? children : undefined,
    }
  }

  const roots = keptRows.filter((row) => !effectiveParentId.get(row.id)).toSorted(compareNodes)

  return roots.map(toNode).filter((node): node is MenuTreeNode => node !== null)
}

@Injectable()
export class MenusService {
  private readonly logger = new Logger(MenusService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly menuCache: MenuCacheService,
    private readonly permissionService: PermissionService,
    private readonly organizationService: OrganizationService,
  ) {}

  /**
   * 获取当前登录用户的有效菜单树
   *
   * 唯一入参是认证上下文中的 userId：
   * 角色、角色菜单、菜单有效性全部由服务端从数据库解析，
   * 不接受客户端传入的 userId / roleId。
   */
  async getCurrentUserMenus(userId: string): Promise<MenuTreeNode[]> {
    const context = await this.permissionService.resolveRoleContext(userId)

    if (context.assignments.length === 0) {
      this.logger.warn(`用户 ${userId} 没有有效角色，返回空菜单`)

      return []
    }

    const ttlSeconds = this.cacheTtlSeconds(context.nextExpiry)

    // 最近资格已经到期：不返回旧菜单，也不写入缓存
    if (ttlSeconds === 0) return []

    return this.menuCache.getOrBuild(
      userId,
      () => this.buildFromAssignments(context.assignments),
      ttlSeconds,
    )
  }

  /**
   * 回源查询并计算菜单树（缓存未命中时执行）
   *
   * 有效角色完全复用 PermissionService 的判定：
   * 已撤销、未生效、已过期、角色停用的分配都不会产生菜单，
   * 避免菜单授权与接口授权使用两套不一致的规则。
   */
  async loadUserMenus(userId: string): Promise<MenuTreeNode[]> {
    const context = await this.permissionService.resolveRoleContext(userId)

    return this.buildFromAssignments(context.assignments)
  }

  /** 缓存 TTL 不得超过最近一次资格到期时间 */
  private cacheTtlSeconds(nextExpiry: Date | null): number | undefined {
    if (!nextExpiry) return undefined

    const seconds = Math.ceil((nextExpiry.getTime() - Date.now()) / 1000)

    return seconds <= 0 ? 0 : seconds
  }

  private async buildFromAssignments(
    assignments: Awaited<ReturnType<PermissionService['resolveRoleContext']>>['assignments'],
  ): Promise<MenuTreeNode[]> {
    const usableAssignments: typeof assignments = []

    /**
     * 组织范围停用后，相关角色不得继续产生菜单。
     *
     * 角色分配本身不做级联修改（保留历史与恢复能力），
     * 因此这里在计算时校验授权范围根节点及祖先链是否仍然 ACTIVE。
     */
    for (const assignment of assignments) {
      if (!assignment.scopeOrgUnitId) {
        usableAssignments.push(assignment)

        continue
      }

      if (await this.organizationService.isPathActive(assignment.scopeOrgUnitId)) {
        usableAssignments.push(assignment)
      }
    }

    const roleIds = [...new Set(usableAssignments.map((assignment) => assignment.roleId))]

    if (roleIds.length === 0) {
      this.logger.warn('没有可用的组织授权范围，返回空菜单')

      return []
    }

    const menuIds = await this.findAuthorizedMenuIds(roleIds)

    if (menuIds.length === 0) return []

    const rows = await this.loadMenusWithAncestors(menuIds)

    return buildMenuTree(rows, this.logger)
  }

  /** 多角色菜单合并：RoleMenu 中所有已授权菜单 id（按 id 去重） */
  private async findAuthorizedMenuIds(roleIds: string[]): Promise<string[]> {
    const rows = await this.prisma.roleMenu.findMany({
      where: { roleId: { in: roleIds } },
      select: { menuId: true },
    })

    return [...new Set(rows.map((row) => row.menuId))]
  }

  /**
   * 按授权菜单 id 递归补齐祖先目录
   *
   * 只按 id 取数据，status 过滤留给 buildMenuTree：
   * 这样才能识别「祖先被停用」并整棵子树丢弃。
   */
  private async loadMenusWithAncestors(menuIds: string[]): Promise<MenuQueryRow[]> {
    const rows = new Map<string, MenuQueryRow>()
    let pendingIds = [...new Set(menuIds)]

    while (pendingIds.length > 0) {
      const batch = await this.prisma.menu.findMany({
        where: { id: { in: pendingIds } },
        select: MENU_SELECT,
      })

      for (const row of batch) {
        if (!rows.has(row.id)) rows.set(row.id, row as MenuQueryRow)
      }

      // 下一批只取尚未加载过的父节点，天然防止循环引用导致的死循环
      const nextIds = new Set<string>()

      for (const row of batch) {
        if (row.parentId && !rows.has(row.parentId)) nextIds.add(row.parentId)
      }

      pendingIds = [...nextIds]
    }

    return [...rows.values()]
  }
}
