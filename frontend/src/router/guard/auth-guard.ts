import { resolveSafeRedirect } from '@/lib/redirect'
import pinia from '@/plugins/pinia/setup'
import { resetDynamicRouting, ensureDynamicRoutes } from '@/router/dynamic/bootstrap'
import { useAuthStore } from '@/stores/auth'
import { useMenuStore } from '@/stores/menu'
import { storeToRefs } from 'pinia'
import type { Router } from 'vue-router'

const AUTH_PAGES = ['/auth/sign-in', '/auth/sign-up']

/**
 * 公开路由：
 * - 根路径会重定向到 /dashboard，由后续守卫继续判断
 * - 认证页、错误页（含 404）无需登录
 */
function isPublicPath(path: string): boolean {
  return path === '/' || path.startsWith('/auth/') || path.startsWith('/errors/')
}

export function setupAuthGuard(router: Router) {
  router.beforeEach(async (to) => {
    const authStore = useAuthStore(pinia)
    const menuStore = useMenuStore(pinia)
    const { isAuthenticated } = storeToRefs(authStore)

    // 页面刷新时先恢复认证状态；初始化完成前不提前把用户判定为未登录
    await authStore.initialize()

    const isAuthPage = AUTH_PAGES.includes(to.path)

    // 未登录：清掉上一个用户可能残留的动态路由与菜单，再决定放行或跳登录页
    if (!isAuthenticated.value) {
      resetDynamicRouting(menuStore)

      if (isPublicPath(to.path)) return true

      return {
        path: '/auth/sign-in',
        query: { redirect: to.fullPath },
      }
    }

    // 已登录：菜单是业务路由的唯一来源，加载失败时保持未注册状态（落到 404）
    const status = await ensureDynamicRoutes(router, menuStore)

    // 已登录用户访问登录/注册页，跳回目标页或工作台
    if (isAuthPage) return resolveSafeRedirect(to.query.redirect)

    // 动态路由是在本次导航中才注册的，需要重新导航一次让目标地址按新路由匹配
    if (status === 'loaded') return to.fullPath

    return true
  })
}
