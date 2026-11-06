import type { MenuTreeNode } from '@graduation/shared'
import { DEFAULT_MENU_TREE } from '@graduation/shared'
import type { RouteMeta, RouteRecordRaw, Router } from 'vue-router'

import { resolveViewComponent } from './component-registry'
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
 * DIRECTORY 节点不生成路由。
 */

/** 默认布局（懒加载） */
const DefaultLayout = () => import('@/layouts/default.vue')

/** 已注册的动态路由 name，切换用户或重新拉取菜单时用于清理 */
const registeredRouteNames = new Set<string>()

function createRouteMeta(node: MenuTreeNode): RouteMeta {
  return {
    title: node.title,
    menuCode: node.code,
    icon: node.icon,
  }
}

export function buildDynamicRoutes(menuTree: MenuTreeNode[] = DEFAULT_MENU_TREE): RouteRecordRaw[] {
  return flattenPages(menuTree)
    .filter((node) => node.path && node.componentKey)
    .map((node) => {
      const component = resolveViewComponent(node.componentKey)

      return {
        path: node.path!,
        name: node.code,
        component: DefaultLayout,
        meta: createRouteMeta(node),
        children: [
          {
            path: '',
            component,
            meta: createRouteMeta(node),
          },
        ],
      } as RouteRecordRaw
    })
}

/** 注册动态路由（重复调用会覆盖同名路由） */
export function setupDynamicRoutes(router: Router, menuTree: MenuTreeNode[] = DEFAULT_MENU_TREE) {
  for (const route of buildDynamicRoutes(menuTree)) {
    router.addRoute(route)

    if (typeof route.name === 'string') {
      registeredRouteNames.add(route.name)
    }
  }
}

/** 清除已注册的动态路由，用于退出登录或菜单变更后重建 */
export function resetDynamicRoutes(router: Router) {
  for (const name of registeredRouteNames) {
    if (router.hasRoute(name)) {
      router.removeRoute(name)
    }
  }
  registeredRouteNames.clear()
}
