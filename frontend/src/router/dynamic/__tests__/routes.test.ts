import type { MenuTreeNode } from '@graduation/shared'
import { DEFAULT_MENU_TREE } from '@graduation/shared'
import { describe, expect, it } from 'vitest'

import { hasViewComponent } from '../component-registry'
import { flattenPages, toNavGroups } from '../nav'
import { buildDynamicRoutes } from '../routes'

const pageNodes = flattenPages(DEFAULT_MENU_TREE)

describe('default menu tree', () => {
  it('V1 菜单包含 19 个页面节点', () => {
    expect(pageNodes).toHaveLength(19)
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
    const routes = buildDynamicRoutes()
    const names = routes.map((route) => route.name)

    expect(routes).toHaveLength(pageNodes.length)
    expect(new Set(names).size).toBe(names.length)
  })

  it('路由 path 与菜单 path 一致', () => {
    const routes = buildDynamicRoutes()
    const routePaths = routes.map((route) => route.path).sort()
    const menuPaths = pageNodes.map((page) => page.path!).sort()

    expect(routePaths).toEqual(menuPaths)
  })
})

describe('sidebar navigation', () => {
  it('三级菜单被扁平化为 7 个分组', () => {
    const groups = toNavGroups(DEFAULT_MENU_TREE)

    expect(groups.map((group) => group.title)).toEqual([
      '工作台',
      '选题管理',
      '过程管理',
      '论文与答辩',
      'AI 助手',
      '组织与人员管理',
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
})

function collectDirectories(nodes: MenuTreeNode[]): MenuTreeNode[] {
  return nodes.flatMap((node) => {
    if (node.type !== 'DIRECTORY') return []
    return [node, ...collectDirectories(node.children ?? [])]
  })
}
