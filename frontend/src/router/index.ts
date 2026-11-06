import { setupLayouts } from 'virtual:generated-layouts'
import { createRouter, createWebHistory } from 'vue-router'
import { handleHotUpdate, routes } from 'vue-router/auto-routes'

import { setupDynamicRoutes } from './dynamic'
import { setupRouterGuard } from './guard'

const router = createRouter({
  history: createWebHistory(),
  routes: setupLayouts(routes),

  scrollBehavior() {
    return { left: 0, top: 0, behavior: 'smooth' }
  },
})

// 注册动态业务路由（由动态菜单树生成，页面文件位于 src/views）
setupDynamicRoutes(router)

setupRouterGuard(router)

export default router

if (import.meta.hot) {
  handleHotUpdate(router)
}
