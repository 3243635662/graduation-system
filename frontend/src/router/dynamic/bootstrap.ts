import type { useMenuStore } from '@/stores/menu'
import type { MenuTreeNode } from '@graduation/shared'
import type { Router } from 'vue-router'

import { rebuildDynamicRoutes, resetDynamicRoutes } from './routes'

type MenuStore = ReturnType<typeof useMenuStore>

/**
 * 动态路由引导状态
 *
 * - ready ：当前用户的动态路由已注册
 * - loaded：本次调用刚刚完成注册，调用方需要重新触发一次导航以匹配新路由
 * - failed：菜单接口失败，本次不注册任何业务路由（绝不回退默认菜单）
 */
export type DynamicRouteStatus = 'ready' | 'loaded' | 'failed'

let routesReady = false
let pending: Promise<DynamicRouteStatus> | null = null
let epoch = 0

/**
 * 确保当前用户的动态路由已注册
 *
 * 并发调用共享同一个 Promise，避免重复请求菜单与重复注册路由。
 */
export function ensureDynamicRoutes(
  router: Router,
  menuStore: MenuStore,
): Promise<DynamicRouteStatus> {
  if (routesReady && menuStore.loaded) return Promise.resolve('ready')
  if (pending) return pending

  let task: Promise<DynamicRouteStatus>

  task = run(router, menuStore).finally(() => {
    // 只清理自己，避免把 reset 之后新建的单飞任务误删
    if (pending === task) pending = null
  })

  pending = task

  return task
}

async function run(router: Router, menuStore: MenuStore): Promise<DynamicRouteStatus> {
  const runEpoch = epoch

  let tree: MenuTreeNode[]

  try {
    tree = await menuStore.load()
  } catch (error) {
    console.error('[router] 加载当前用户菜单失败，本次不注册任何业务路由：', error)

    return 'failed'
  }

  // 期间发生过退出登录 / 切换用户：丢弃这批路由
  if (runEpoch !== epoch) return 'failed'

  rebuildDynamicRoutes(router, tree)

  routesReady = true

  return 'loaded'
}

/** 清空动态路由与菜单状态（退出登录、认证过期、切换用户） */
export function resetDynamicRouting(menuStore: MenuStore): void {
  epoch += 1
  pending = null
  routesReady = false

  resetDynamicRoutes()
  menuStore.reset()
}
