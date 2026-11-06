import type { NavGroup, NavItem } from '@/components/app-sidebar/types'
import type { MenuTreeNode } from '@graduation/shared'

import { resolveMenuIcon } from './icons'

/**
 * 菜单树 -> 侧边栏导航数据
 *
 * 当前侧边栏组件（collapsible / vercel）只支持两级结构，
 * 因此这里做一次扁平化：
 * - 根级 PAGE        -> 独立分组
 * - 目录下的直接页面 -> 归入以目录名命名的分组
 * - 子目录           -> 提升为独立分组，其页面作为该组条目
 *
 * 后续若侧边栏支持三级递归，可改为直接透传菜单树。
 */

function toNavItem(node: MenuTreeNode): NavItem {
  const icon = resolveMenuIcon(node.icon)
  const children = (node.children ?? []).filter((child) => child.visible !== false)

  if (children.length > 0) {
    return {
      title: node.title,
      icon,
      items: children.map(toNavItem),
    }
  }

  return {
    title: node.title,
    url: node.path ?? '/',
    icon,
  }
}

export function toNavGroups(menuTree: MenuTreeNode[]): NavGroup[] {
  const groups: NavGroup[] = []

  for (const node of menuTree) {
    if (node.visible === false) continue

    if (node.type === 'PAGE') {
      groups.push({ title: node.title, items: [toNavItem(node)] })
      continue
    }

    const children = (node.children ?? []).filter((child) => child.visible !== false)
    const directPages = children.filter((child) => child.type === 'PAGE')

    if (directPages.length > 0) {
      groups.push({ title: node.title, items: directPages.map(toNavItem) })
    }

    for (const directory of children.filter((child) => child.type === 'DIRECTORY')) {
      const items = (directory.children ?? [])
        .filter((child) => child.visible !== false)
        .map(toNavItem)

      if (items.length > 0) {
        groups.push({ title: directory.title, items })
      }
    }
  }

  return groups
}

/** 拍平菜单树中的所有页面节点，供搜索面板 / 动态路由使用 */
export function flattenPages(menuTree: MenuTreeNode[]): MenuTreeNode[] {
  return menuTree.flatMap((node) => {
    if (node.type === 'PAGE') return [node]
    return flattenPages(node.children ?? [])
  })
}
