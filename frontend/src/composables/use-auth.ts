import { resolveSafeRedirect } from '@/lib/redirect'
import { ensureDynamicRoutes, resetDynamicRouting } from '@/router/dynamic'
import { useAuthStore } from '@/stores/auth'
import { useMenuStore } from '@/stores/menu'
import type { LoginInput, RegisterInput } from '@graduation/shared'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'

export function useAuth() {
  const router = useRouter()
  const authStore = useAuthStore()
  const menuStore = useMenuStore()
  const { user, roles, isAuthenticated, isInitializing } = storeToRefs(authStore)

  async function login(input: LoginInput): Promise<void> {
    await authStore.login(input)

    // 登录成功后按当前用户的真实菜单注册业务路由
    await ensureDynamicRoutes(router, menuStore)
    await router.replace(resolveSafeRedirect(router.currentRoute.value.query.redirect))
  }

  async function register(input: RegisterInput): Promise<void> {
    await authStore.register(input)

    await ensureDynamicRoutes(router, menuStore)
    await router.replace('/dashboard')
  }

  async function logout(): Promise<void> {
    try {
      await authStore.logout()
    } finally {
      // 即使登出接口失败也要清理本地状态：
      // 切换账号/退出登录时清掉旧用户的菜单与动态路由，避免残留旧权限页面
      resetDynamicRouting(menuStore)
      await router.replace('/auth/sign-in')
    }
  }

  return {
    user,
    roles,
    isAuthenticated,
    isInitializing,
    login,
    register,
    logout,
  }
}
