import { resolveSafeRedirect } from '@/lib/redirect'
import { resetDynamicRoutes, setupDynamicRoutes } from '@/router/dynamic'
import { useAuthStore } from '@/stores/auth'
import type { LoginInput, RegisterInput } from '@graduation/shared'
import { storeToRefs } from 'pinia'
import { useRouter } from 'vue-router'

export function useAuth() {
  const router = useRouter()
  const authStore = useAuthStore()
  const { user, roles, isAuthenticated, isInitializing } = storeToRefs(authStore)

  async function login(input: LoginInput): Promise<void> {
    await authStore.login(input)

    // 登录成功后确保业务路由已注册，再跳转到原本要访问的页面
    setupDynamicRoutes(router)
    await router.replace(resolveSafeRedirect(router.currentRoute.value.query.redirect))
  }

  async function register(input: RegisterInput): Promise<void> {
    await authStore.register(input)

    setupDynamicRoutes(router)
    await router.replace('/dashboard')
  }

  async function logout(): Promise<void> {
    await authStore.logout()

    // 退出登录后清理动态路由，避免残留的业务路由被未登录用户访问
    resetDynamicRoutes(router)
    await router.replace('/auth/sign-in')
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
