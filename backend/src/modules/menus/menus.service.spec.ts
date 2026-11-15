import type { MenuTreeNode } from '@graduation/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PrismaService } from '../../prisma/prisma.service.js'
import type { PermissionService } from '../rbac/authorization/permission.service.js'
import type { OrganizationService } from '../rbac/organizations/organization.service.js'
import type { MenuCacheService } from './menu-cache.service.js'
import { MenusService, buildMenuTree } from './menus.service.js'
import type { MenuQueryRow } from './types/menu-cache.type.js'

function row(partial: Partial<MenuQueryRow> & Pick<MenuQueryRow, 'id' | 'code'>): MenuQueryRow {
  return {
    title: partial.code,
    path: null,
    componentKey: null,
    icon: null,
    type: 'PAGE',
    parentId: null,
    sortOrder: 1,
    visible: true,
    status: 'ACTIVE',
    ...partial,
  }
}

const graduation = row({ id: 'm-grad', code: 'GRADUATION', type: 'DIRECTORY', sortOrder: 10 })
const topicDir = row({
  id: 'm-topic-dir',
  code: 'TOPIC_MANAGEMENT',
  type: 'DIRECTORY',
  parentId: 'm-grad',
  sortOrder: 1,
})
const topicCenter = row({
  id: 'm-topic-center',
  code: 'TOPIC_CENTER',
  path: '/topics',
  componentKey: 'topics/index',
  parentId: 'm-topic-dir',
  sortOrder: 1,
})
const myTopic = row({
  id: 'm-my-topic',
  code: 'MY_TOPIC',
  path: '/topics/my',
  componentKey: 'topics/my',
  parentId: 'm-topic-dir',
  sortOrder: 2,
})
const dashboard = row({
  id: 'm-dashboard',
  code: 'DASHBOARD',
  path: '/dashboard',
  componentKey: 'dashboard/index',
  sortOrder: 1,
})

describe('buildMenuTree', () => {
  it('为授权页面递归补齐 DIRECTORY 祖先', () => {
    const tree = buildMenuTree([topicCenter, topicDir, graduation])

    expect(tree).toHaveLength(1)
    expect(tree[0]?.code).toBe('GRADUATION')
    expect(tree[0]?.children?.[0]?.code).toBe('TOPIC_MANAGEMENT')
    expect(tree[0]?.children?.[0]?.children?.[0]?.code).toBe('TOPIC_CENTER')
  })

  it('同一菜单被多个角色关联时按 id 去重', () => {
    const tree = buildMenuTree([topicCenter, topicCenter, topicDir, graduation])

    expect(tree).toHaveLength(1)
    expect(tree[0]?.children?.[0]?.children).toHaveLength(1)
  })

  it('同级按 sortOrder 升序排序', () => {
    const tree = buildMenuTree([topicCenter, myTopic, topicDir, graduation, dashboard])

    expect(tree.map((node) => node.code)).toEqual(['DASHBOARD', 'GRADUATION'])
    expect(tree[1]?.children?.[0]?.children?.map((node) => node.code)).toEqual([
      'TOPIC_CENTER',
      'MY_TOPIC',
    ])
  })

  it('不返回没有页面的空目录', () => {
    const emptyDir = row({ id: 'm-empty', code: 'EMPTY', type: 'DIRECTORY', sortOrder: 99 })
    const tree = buildMenuTree([dashboard, emptyDir, graduation])

    expect(tree.map((node) => node.code)).toEqual(['DASHBOARD'])
  })

  it('过滤停用的菜单', () => {
    const disabledPage = row({
      id: 'm-disabled',
      code: 'DISABLED_PAGE',
      path: '/disabled',
      componentKey: 'disabled/index',
      status: 'DISABLED',
      sortOrder: 1,
    })

    const tree = buildMenuTree([dashboard, disabledPage])

    expect(tree.map((node) => node.code)).toEqual(['DASHBOARD'])
  })

  it('目录被停用时整棵子树都不返回，避免子页面变成孤立根节点', () => {
    const disabledDir = { ...topicDir, status: 'DISABLED' }
    const tree = buildMenuTree([dashboard, topicCenter, disabledDir, graduation])

    expect(tree.map((node) => node.code)).toEqual(['DASHBOARD'])
  })

  it('PAGE 缺少 componentKey 时不作为合法业务页面返回', () => {
    const brokenPage = row({
      id: 'm-broken',
      code: 'BROKEN',
      path: '/broken',
      componentKey: null,
      parentId: 'm-topic-dir',
    })

    const tree = buildMenuTree([topicCenter, brokenPage, topicDir, graduation])

    expect(tree[0]?.children?.[0]?.children?.map((node) => node.code)).toEqual(['TOPIC_CENTER'])
  })

  it('PAGE 缺少 path 时同样被排除', () => {
    const brokenPage = row({
      id: 'm-broken',
      code: 'BROKEN',
      path: null,
      componentKey: 'broken/index',
    })

    expect(buildMenuTree([brokenPage])).toEqual([])
  })

  it('visible=false 的页面保留授权数据（侧边栏隐藏由前端处理）', () => {
    const hiddenPage = { ...dashboard, visible: false }

    const tree = buildMenuTree([hiddenPage])

    expect(tree).toHaveLength(1)
    expect(tree[0]?.visible).toBe(false)
  })

  it('循环引用不会导致无限递归', () => {
    const loopA = row({ id: 'm-loop-a', code: 'LOOP_A', type: 'DIRECTORY', parentId: 'm-loop-b' })
    const loopB = row({ id: 'm-loop-b', code: 'LOOP_B', type: 'DIRECTORY', parentId: 'm-loop-a' })

    expect(() => buildMenuTree([loopA, loopB])).not.toThrow()
    expect(buildMenuTree([loopA, loopB])).toEqual([])
  })

  it('空输入返回空数组', () => {
    expect(buildMenuTree([])).toEqual([])
  })

  it('父节点不是目录时，子页面按根节点输出且 parentId 归一化为 null', () => {
    const parentPage = row({
      id: 'm-parent-page',
      code: 'PARENT_PAGE',
      path: '/parent',
      componentKey: 'parent/index',
      sortOrder: 1,
    })
    const childPage = row({
      id: 'm-child-page',
      code: 'CHILD_PAGE',
      path: '/parent/child',
      componentKey: 'parent/child',
      parentId: 'm-parent-page',
      sortOrder: 2,
    })

    const tree = buildMenuTree([parentPage, childPage])

    // PAGE 不能充当分组，两个页面都作为根节点返回
    expect(tree.map((node) => node.code)).toEqual(['PARENT_PAGE', 'CHILD_PAGE'])

    for (const node of tree) {
      expect(node.parentId).toBeNull()
    }
  })

  it('父节点未被保留时 parentId 不会指向结果集之外的节点', () => {
    // 未授权的 PAGE 父节点根本不会进入 rows
    const orphan = row({
      id: 'm-orphan',
      code: 'ORPHAN',
      path: '/orphan',
      componentKey: 'orphan/index',
      parentId: 'm-not-authorized',
    })

    const tree = buildMenuTree([orphan])

    expect(tree).toHaveLength(1)
    expect(tree[0]?.parentId).toBeNull()
  })
})

interface MenusFakeOptions {
  roleMenus?: string[]
  menus?: MenuQueryRow[]
}

function createPrismaFake(options: MenusFakeOptions = {}) {
  const roleMenuIds = options.roleMenus ?? []
  const menus = options.menus ?? []

  return {
    roleMenu: {
      findMany: vi.fn(() => Promise.resolve(roleMenuIds.map((menuId) => ({ menuId })))),
    },
    menu: {
      findMany: vi.fn(({ where }: { where: { id: { in: string[] } } }) =>
        Promise.resolve(menus.filter((menu) => where.id.in.includes(menu.id))),
      ),
    },
  }
}

/**
 * 有效角色由 PermissionService 统一判定（撤销/过期/停用角色已在上游过滤），
 * 菜单服务只消费结果，不重复实现授权规则。
 */
function createPermissionFake(roleIds: string[] = [], nextExpiry: Date | null = null) {
  const buildAssignments = () =>
    roleIds.map((roleId, index) => ({
      assignmentId: `assignment-${index}`,
      roleId,
      roleCode: 'TEST_ROLE',
      roleName: '测试角色',
      dataScope: 'SELF' as const,
      scopeOrgUnitId: null,
      validFrom: new Date(0),
      validUntil: null,
    }))

  const findEffectiveAssignments = vi.fn(async () => buildAssignments())

  const resolveRoleContext = vi.fn(async () => ({
    assignments: buildAssignments(),
    nextExpiry,
  }))

  return { findEffectiveAssignments, resolveRoleContext }
}

/** 组织授权路径是否 ACTIVE：默认全部有效 */
function createOrganizationFake(activeOrgIds: string[] = []) {
  const isPathActive = vi.fn(async (id: string) => activeOrgIds.includes(id))

  return { isPathActive }
}

describe('MenusService', () => {
  const getOrBuild = vi.fn(
    (_userId: string, build: () => Promise<MenuTreeNode[]>, _ttlSeconds?: number) => build(),
  )
  const cache = { getOrBuild } as unknown as MenuCacheService

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('通过缓存层获取菜单（Cache Aside 入口）', async () => {
    const prisma = createPrismaFake({
      roleMenus: [dashboard.id],
      menus: [dashboard],
    })
    const permissions = createPermissionFake(['role-student'])

    const service = new MenusService(
      prisma as unknown as PrismaService,
      cache,
      permissions as unknown as PermissionService,
      createOrganizationFake() as unknown as OrganizationService,
    )

    await expect(service.getCurrentUserMenus('user-existing')).resolves.toEqual([
      expect.objectContaining({ code: 'DASHBOARD' }),
    ])
    expect(getOrBuild).toHaveBeenCalledWith('user-existing', expect.any(Function), undefined)
  })

  it('用户没有有效角色时返回空菜单', async () => {
    const prisma = createPrismaFake()
    const permissions = createPermissionFake([])
    const service = new MenusService(
      prisma as unknown as PrismaService,
      cache,
      permissions as unknown as PermissionService,
      createOrganizationFake() as unknown as OrganizationService,
    )

    await expect(service.loadUserMenus('user-existing')).resolves.toEqual([])
    expect(prisma.roleMenu.findMany).not.toHaveBeenCalled()
  })

  it('多角色菜单合并后按 id 去重', async () => {
    const prisma = createPrismaFake({
      // 两个角色都关联了 DASHBOARD
      roleMenus: [dashboard.id, dashboard.id, topicCenter.id],
      menus: [dashboard, topicCenter, topicDir, graduation],
    })
    const permissions = createPermissionFake(['role-student', 'role-teacher'])

    const service = new MenusService(
      prisma as unknown as PrismaService,
      cache,
      permissions as unknown as PermissionService,
      createOrganizationFake() as unknown as OrganizationService,
    )
    const tree = await service.loadUserMenus('user-existing')

    expect(prisma.roleMenu.findMany).toHaveBeenCalledWith({
      where: { roleId: { in: ['role-student', 'role-teacher'] } },
      select: { menuId: true },
    })
    expect(tree.map((node) => node.code)).toEqual(['DASHBOARD', 'GRADUATION'])
  })

  it('只按认证上下文中的 userId 解析角色，不接受外部 roleId', async () => {
    const prisma = createPrismaFake({ roleMenus: [dashboard.id], menus: [dashboard] })
    const permissions = createPermissionFake(['role-student'])

    const service = new MenusService(
      prisma as unknown as PrismaService,
      cache,
      permissions as unknown as PermissionService,
      createOrganizationFake() as unknown as OrganizationService,
    )

    await service.loadUserMenus('user-existing')

    expect(permissions.resolveRoleContext).toHaveBeenCalledTimes(1)
    expect(permissions.resolveRoleContext).toHaveBeenCalledWith('user-existing')
  })

  it('菜单缓存 TTL 不超过最近资格到期时间', async () => {
    const prisma = createPrismaFake({ roleMenus: [dashboard.id], menus: [dashboard] })
    const nextExpiry = new Date(Date.now() + 30_000)
    const permissions = createPermissionFake(['role-coordinator'], nextExpiry)

    const service = new MenusService(
      prisma as unknown as PrismaService,
      cache,
      permissions as unknown as PermissionService,
      createOrganizationFake() as unknown as OrganizationService,
    )

    await service.getCurrentUserMenus('user-existing')

    const ttl = getOrBuild.mock.calls[0]?.[2] as number

    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(30)
  })

  it('最近资格已到期时不返回菜单也不写缓存', async () => {
    const prisma = createPrismaFake({ roleMenus: [dashboard.id], menus: [dashboard] })
    const permissions = createPermissionFake(['role-coordinator'], new Date(Date.now() - 1_000))

    const service = new MenusService(
      prisma as unknown as PrismaService,
      cache,
      permissions as unknown as PermissionService,
      createOrganizationFake() as unknown as OrganizationService,
    )

    await expect(service.getCurrentUserMenus('user-existing')).resolves.toEqual([])
    expect(getOrBuild).not.toHaveBeenCalled()
  })

  it('同一角色在多个组织范围的重复分配不会重复查询菜单', async () => {
    const prisma = createPrismaFake({ roleMenus: [dashboard.id], menus: [dashboard] })
    const permissions = createPermissionFake(['role-coordinator', 'role-coordinator'])

    const service = new MenusService(
      prisma as unknown as PrismaService,
      cache,
      permissions as unknown as PermissionService,
      createOrganizationFake() as unknown as OrganizationService,
    )

    await service.loadUserMenus('user-existing')

    expect(prisma.roleMenu.findMany).toHaveBeenCalledWith({
      where: { roleId: { in: ['role-coordinator'] } },
      select: { menuId: true },
    })
  })

  it('组织授权范围停用后，该角色不再产生菜单', async () => {
    const prisma = createPrismaFake({ roleMenus: [dashboard.id], menus: [dashboard] })

    const assignments = [
      {
        assignmentId: 'assignment-1',
        roleId: 'role-coordinator',
        roleCode: 'CLASS_COORDINATOR',
        roleName: '班级事务协管员',
        dataScope: 'CLASS' as const,
        scopeOrgUnitId: 'org-se-1',
        validFrom: new Date(0),
        validUntil: null,
      },
    ]

    const permissions = {
      findEffectiveAssignments: vi.fn(async () => assignments),
      resolveRoleContext: vi.fn(async () => ({ assignments, nextExpiry: null })),
    }

    const service = new MenusService(
      prisma as unknown as PrismaService,
      cache,
      permissions as unknown as PermissionService,
      createOrganizationFake([]) as unknown as OrganizationService,
    )

    await expect(service.loadUserMenus('user-existing')).resolves.toEqual([])
    expect(prisma.roleMenu.findMany).not.toHaveBeenCalled()
  })

  it('组织授权范围恢复后，同一分配重新产生菜单', async () => {
    const prisma = createPrismaFake({ roleMenus: [dashboard.id], menus: [dashboard] })

    const assignments = [
      {
        assignmentId: 'assignment-1',
        roleId: 'role-coordinator',
        roleCode: 'CLASS_COORDINATOR',
        roleName: '班级事务协管员',
        dataScope: 'CLASS' as const,
        scopeOrgUnitId: 'org-se-1',
        validFrom: new Date(0),
        validUntil: null,
      },
    ]

    const permissions = {
      findEffectiveAssignments: vi.fn(async () => assignments),
      resolveRoleContext: vi.fn(async () => ({ assignments, nextExpiry: null })),
    }

    const service = new MenusService(
      prisma as unknown as PrismaService,
      cache,
      permissions as unknown as PermissionService,
      createOrganizationFake(['org-se-1']) as unknown as OrganizationService,
    )

    const tree = await service.loadUserMenus('user-existing')

    expect(tree.map((node) => node.code)).toEqual(['DASHBOARD'])
  })
})
