import { resolveSafeRedirect } from '@/lib/redirect'
import pinia from '@/plugins/pinia/setup'
import { useAuthStore } from '@/stores/auth'
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
    const { isAuthenticated } = storeToRefs(authStore)

    // 页面刷新时先恢复认证状态；初始化完成前不提前把用户判定为未登录
    await authStore.initialize()

    const isAuthPage = AUTH_PAGES.includes(to.path)

    // 已登录用户访问登录/注册页，跳回目标页或工作台
    if (isAuthenticated.value && isAuthPage) {
      return resolveSafeRedirect(to.query.redirect)
    }

    // 未登录访问业务页面，跳转登录页并记录原本要访问的地址
    if (!isAuthenticated.value && !isPublicPath(to.path)) {
      return {
        path: '/auth/sign-in',
        query: { redirect: to.fullPath },
      }
    }

    return true
  })
}
