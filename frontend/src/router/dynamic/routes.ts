import type { MenuTreeNode } from '@graduation/shared'
import type { RouteMeta, RouteRecordRaw, Router } from 'vue-router'

import { hasViewComponent, resolveViewComponent } from './component-registry'
import { flattenPages } from './nav'

/**
 * 动态路由构建
 *
 * 菜单树中的 PAGE 节点会被转换为路由：
 *   code         -> 路由 name
 *   path         -> 路由地址
 *   componentKey -> src/views 下的页面组件
 *
 * 所有业务页面都挂载在 default 布局下，因此这里为每条页面路由包一层布局。
 * DIRECTORY 节点只用于导航分组，不生成路由。
 */

/** 默认布局（懒加载） */
const DefaultLayout = () => import('@/layouts/default.vue')

/** 已注册动态路由的移除函数（addRoute 的返回值） */
const routeRemovers: Array<() => void> = []

function createRouteMeta(node: MenuTreeNode): RouteMeta {
  return {
    title: node.title,
    menuCode: node.code,
    icon: node.icon,
  }
}

/**
 * 由菜单树构建路由表
 *
 * 安全约束：
 * - 只按 componentKey 在本地 src/views 注册表中查找组件，绝不按后端路径动态 import
 * - componentKey 未登记时跳过该页面并记录开发错误，绝不复用不相关的业务页面
 * - 同一 name / path 只注册一次，防止多角色菜单重复
 */
export function buildDynamicRoutes(menuTree: MenuTreeNode[]): RouteRecordRaw[] {
  const routes: RouteRecordRaw[] = []
  const usedNames = new Set<string>()
  const usedPaths = new Set<string>()

  for (const node of flattenPages(menuTree)) {
    if (!node.path || !node.componentKey) {
      console.error(`[router] 菜单 ${node.code} 缺少 path 或 componentKey，已跳过该页面`)

      continue
    }

    if (usedNames.has(node.code) || usedPaths.has(node.path)) {
      console.warn(`[router] 菜单 ${node.code} 重复，已跳过重复路由`)

      continue
    }

    if (!hasViewComponent(node.componentKey)) {
      console.error(
        `[router] 菜单 ${node.code} 的 componentKey "${node.componentKey}" 不在本地组件注册表中，已跳过该页面`,
      )

      continue
    }

    usedNames.add(node.code)
    usedPaths.add(node.path)

    routes.push({
      path: node.path,
      name: node.code,
      component: DefaultLayout,
      meta: createRouteMeta(node),
      children: [
        {
          path: '',
          component: resolveViewComponent(node.componentKey),
          meta: createRouteMeta(node),
        },
      ],
    } as RouteRecordRaw)
  }

  return routes
}

/** 注册动态路由（同名路由已存在时跳过，重复调用安全） */
export function setupDynamicRoutes(router: Router, menuTree: MenuTreeNode[]): void {
  for (const route of buildDynamicRoutes(menuTree)) {
    if (typeof route.name === 'string' && router.hasRoute(route.name)) continue

    routeRemovers.push(router.addRoute(route))
  }
}

/**
 * 清除已注册的动态路由
 *
 * 只移除本模块通过 addRoute 添加的路由，不使用 getRoutes() 无差别删除，
 * 因此静态路由（认证页、错误页、404 等）不受影响。
 */
export function resetDynamicRoutes(): void {
  while (routeRemovers.length > 0) {
    const remove = routeRemovers.pop()

    try {
      remove?.()
    } catch (error) {
      console.error('[router] 移除动态路由失败：', error)
    }
  }
}

/** 原子重建：先清理当前用户的全部动态路由，再按最新菜单注册 */
export function rebuildDynamicRoutes(router: Router, menuTree: MenuTreeNode[]): void {
  resetDynamicRoutes()
  setupDynamicRoutes(router, menuTree)
}
