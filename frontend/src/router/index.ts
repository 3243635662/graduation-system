import { onSessionExpired } from '@/lib/auth-events'
import pinia from '@/plugins/pinia/setup'
import { useAuthStore } from '@/stores/auth'
import { useMenuStore } from '@/stores/menu'
import { setupLayouts } from 'virtual:generated-layouts'
import { createRouter, createWebHistory } from 'vue-router'
import { handleHotUpdate, routes } from 'vue-router/auto-routes'
import { toast } from 'vue-sonner'

import { resetDynamicRouting } from './dynamic'
import { setupRouterGuard } from './guard'

const router = createRouter({
  history: createWebHistory(),
  routes: setupLayouts(routes),

  scrollBehavior() {
    return { left: 0, top: 0, behavior: 'smooth' }
  },
})

/**
 * 注意：这里不再注册动态业务路由。
 *
 * 业务路由必须由当前登录用户的真实菜单驱动，
 * 注册时机在 auth guard 内：认证恢复 → 拉取菜单 → 注册路由 → 重新导航。
 */
setupRouterGuard(router)

/**
 * 会话过期的组合根处理
 *
 * 请求层（api-client）只负责 emit 事件，这里同时持有 Store 与 Router，
 * 因此可以完成「清理状态 → 清理动态路由 → 提示 → 跳转」的完整收尾，且不产生循环依赖。
 *
 * 只有之前确实处于登录态的请求才提示并跳转，避免未登录状态下的 401 重复跳转。
 */
onSessionExpired(async () => {
  const authStore = useAuthStore(pinia)
  const menuStore = useMenuStore(pinia)
  const hadSession = authStore.isAuthenticated

  authStore.clearSession()

  if (!hadSession) return

  // 认证已失效：必须清掉旧用户的动态路由与菜单，防止残留页面被访问
  resetDynamicRouting(menuStore)

  toast.error('登录状态已失效，请重新登录')

  const current = router.currentRoute.value

  if (current.path !== '/auth/sign-in') {
    await router.push({
      path: '/auth/sign-in',
      query: { redirect: current.fullPath },
    })
  }
})

export default router

if (import.meta.hot) {
  handleHotUpdate(router)
}
