import type { MenuTreeNode } from '@graduation/shared'
import { DEFAULT_MENU_TREE } from '@graduation/shared'
import { describe, expect, it, vi } from 'vitest'
import type { RouteRecordRaw, Router } from 'vue-router'

import { hasViewComponent } from '../component-registry'
import { dedupeMenuTree, flattenPages, toNavGroups } from '../nav'
import { buildDynamicRoutes, rebuildDynamicRoutes, resetDynamicRoutes } from '../routes'

const pageNodes = flattenPages(DEFAULT_MENU_TREE)

/** 最小可用的 Router 替身：只实现动态路由注册需要的方法 */
function createFakeRouter(staticNames: string[] = []) {
  const registered = new Map<string, RouteRecordRaw>()

  for (const name of staticNames) {
    registered.set(name, {
      path: `/${name}`,
      name,
      component: { template: '<div />' },
    } as RouteRecordRaw)
  }

  const router = {
    hasRoute: (name: string | symbol) => registered.has(String(name)),
    addRoute: (route: RouteRecordRaw) => {
      registered.set(String(route.name), route)

      return () => {
        registered.delete(String(route.name))
      }
    },
  }

  return { router: router as unknown as Router, registered }
}

describe('default menu tree', () => {
  it('菜单页面节点数量与后端下发的菜单树一致', () => {
    // 数量由 shared 的 DEFAULT_MENU_TREE 决定，菜单增删后无需再改测试
    expect(pageNodes).toHaveLength(countPages(DEFAULT_MENU_TREE))
  })

  it('所有页面节点都有 path、componentKey 与 icon', () => {
    for (const page of pageNodes) {
      expect(page.path, `${page.code} 缺少 path`).toBeTruthy()
      expect(page.componentKey, `${page.code} 缺少 componentKey`).toBeTruthy()
      expect(page.icon, `${page.code} 缺少 icon`).toBeTruthy()
    }
  })

  it('componentKey 均能在 src/views 中命中组件', () => {
    for (const page of pageNodes) {
      expect(hasViewComponent(page.componentKey!), `${page.componentKey} 未找到页面文件`).toBe(true)
    }
  })

  it('目录节点不携带 componentKey 且都有子节点', () => {
    const directories = collectDirectories(DEFAULT_MENU_TREE)

    for (const directory of directories) {
      expect(directory.componentKey, `${directory.code} 是目录但配置了 componentKey`).toBeFalsy()
      expect(directory.children?.length, `${directory.code} 是目录但没有子节点`).toBeGreaterThan(0)
    }
  })
})

describe('dynamic routes', () => {
  it('按页面节点生成路由，路由 name 唯一', () => {
    const routes = buildDynamicRoutes(DEFAULT_MENU_TREE)
    const names = routes.map((route) => route.name)

    expect(routes).toHaveLength(pageNodes.length)
    expect(new Set(names).size).toBe(names.length)
  })

  it('路由 path 与菜单 path 一致', () => {
    const routes = buildDynamicRoutes(DEFAULT_MENU_TREE)
    const routePaths = routes.map((route) => route.path).sort()
    const menuPaths = pageNodes.map((page) => page.path!).sort()

    expect(routePaths).toEqual(menuPaths)
  })
})

describe('dynamic route safety', () => {
  const base: MenuTreeNode = {
    code: 'SAFE_PAGE',
    title: '安全页面',
    path: '/safe',
    type: 'PAGE',
    componentKey: 'dashboard/index',
    sortOrder: 1,
  }

  it('componentKey 不在本地注册表时跳过该页面', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const routes = buildDynamicRoutes([{ ...base, componentKey: 'not/exist' }])

    expect(routes).toHaveLength(0)
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('PAGE 缺少 componentKey 或 path 时跳过', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(buildDynamicRoutes([{ ...base, componentKey: undefined }])).toHaveLength(0)
    expect(buildDynamicRoutes([{ ...base, path: null }])).toHaveLength(0)

    errorSpy.mockRestore()
  })

  it('重复菜单只注册一条路由', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const routes = buildDynamicRoutes([base, { ...base }])

    expect(routes).toHaveLength(1)
    warnSpy.mockRestore()
  })

  it('DIRECTORY 不生成路由', () => {
    const directory: MenuTreeNode = {
      code: 'DIR_ONLY',
      title: '纯目录',
      path: null,
      type: 'DIRECTORY',
      sortOrder: 1,
      children: [base],
    }

    const routes = buildDynamicRoutes([directory])

    expect(routes.map((route) => route.name)).toEqual(['SAFE_PAGE'])
  })
})

/** 统计菜单树中的 PAGE 节点数量（含一级页面） */
function countPages(nodes: MenuTreeNode[]): number {
  return nodes.reduce(
    (total, node) => total + (node.type === 'PAGE' ? 1 : 0) + countPages(node.children ?? []),
    0,
  )
}

describe('dynamic route lifecycle', () => {
  it('重建时移除旧用户的动态路由，只保留新菜单', () => {
    const { router, registered } = createFakeRouter(['auth-sign-in'])

    rebuildDynamicRoutes(router, DEFAULT_MENU_TREE)
    // 页面数量跟随后端下发的菜单树，避免菜单增删后测试失效（+1 为预置的静态路由）
    expect(registered.size).toBe(countPages(DEFAULT_MENU_TREE) + 1)

    const studentTree: MenuTreeNode[] = [
      {
        code: 'DASHBOARD',
        title: '工作台',
        path: '/dashboard',
        type: 'PAGE',
        componentKey: 'dashboard/index',
        sortOrder: 1,
      },
    ]

    rebuildDynamicRoutes(router, studentTree)

    expect([...registered.keys()].sort()).toEqual(['DASHBOARD', 'auth-sign-in'])
  })

  it('清理动态路由不会删除静态路由', () => {
    const { router, registered } = createFakeRouter(['404'])

    rebuildDynamicRoutes(router, DEFAULT_MENU_TREE)
    resetDynamicRoutes()

    expect([...registered.keys()]).toEqual(['404'])
  })
})

describe('menu tree dedupe', () => {
  it('按 id 去重并保留树结构', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const page: MenuTreeNode = {
      id: 'menu-1',
      code: 'DASHBOARD',
      title: '工作台',
      path: '/dashboard',
      type: 'PAGE',
      componentKey: 'dashboard/index',
      sortOrder: 1,
    }

    const tree = dedupeMenuTree([page, { ...page }])

    expect(tree).toHaveLength(1)
    errorSpy.mockRestore()
  })
})

describe('sidebar navigation', () => {
  it('两级菜单被扁平化为 5 个分组', () => {
    const groups = toNavGroups(DEFAULT_MENU_TREE)

    expect(groups.map((group) => group.title)).toEqual([
      '工作台',
      '用户与人员',
      '组织架构',
      '班级事务',
      '系统管理',
    ])
  })

  it('分组内均为可跳转的页面条目', () => {
    for (const group of toNavGroups(DEFAULT_MENU_TREE)) {
      for (const item of group.items) {
        expect(item.items, `${item.title} 不应再有子级`).toBeUndefined()
        expect(item.url, `${item.title} 缺少 url`).toBeTruthy()
      }
    }
  })

  it('visible=false 的页面不出现在侧边栏', () => {
    const groups = toNavGroups([
      {
        code: 'HIDDEN',
        title: '隐藏页面',
        path: '/hidden',
        type: 'PAGE',
        componentKey: 'dashboard/index',
        sortOrder: 1,
        visible: false,
      },
    ])

    expect(groups).toEqual([])
  })
})

function collectDirectories(nodes: MenuTreeNode[]): MenuTreeNode[] {
  return nodes.flatMap((node) => {
    if (node.type !== 'DIRECTORY') return []
    return [node, ...collectDirectories(node.children ?? [])]
  })
}
