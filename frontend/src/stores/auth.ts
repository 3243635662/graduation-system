import { setAccessToken } from '@/lib/access-token'
import { onSessionRefreshed } from '@/lib/auth-events'
import * as authApi from '@/services/api/auth.api'
import type { AuthUser, LoginInput, RegisterInput } from '@graduation/shared'
import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'

/**
 * 认证状态
 *
 * - Access Token 只存内存，刷新页面后通过 /auth/refresh 恢复
 * - 用户信息来自登录/注册/刷新响应，或用 /auth/me 重新获取
 * - Refresh Token 由 HttpOnly Cookie 持有，Store 不保存任何持久化凭证
 */
export const useAuthStore = defineStore('auth', () => {
  const accessToken = shallowRef<string | null>(null)
  const user = shallowRef<AuthUser | null>(null)
  const isInitializing = ref(false)
  const initialized = ref(false)

  const isAuthenticated = computed(() => Boolean(accessToken.value))
  const roles = computed(() => user.value?.roles ?? [])

  /** 初始化只执行一次；并发调用共享同一个 Promise */
  let initializePromise: Promise<void> | null = null

  function setSession(token: string, nextUser: AuthUser): void {
    accessToken.value = token
    user.value = nextUser
    setAccessToken(token)
  }

  function clearSession(): void {
    accessToken.value = null
    user.value = null
    setAccessToken(null)
  }

  async function login(input: LoginInput): Promise<AuthUser> {
    const result = await authApi.login(input)

    setSession(result.accessToken, result.user)
    initialized.value = true

    return result.user
  }

  async function register(input: RegisterInput): Promise<AuthUser> {
    const result = await authApi.register(input)

    setSession(result.accessToken, result.user)
    initialized.value = true

    return result.user
  }

  async function logout(): Promise<void> {
    try {
      await authApi.logout()
    } finally {
      clearSession()
      initialized.value = true
    }
  }

  async function fetchMe(): Promise<AuthUser> {
    const currentUser = await authApi.getMe()
    user.value = currentUser

    return currentUser
  }

  async function runInitialize(): Promise<void> {
    isInitializing.value = true

    try {
      if (accessToken.value) return

      try {
        const result = await authApi.refresh()
        setSession(result.accessToken, result.user)
      } catch {
        // 没有有效 Refresh Cookie 时属于正常未登录状态
        clearSession()
      }
    } finally {
      initialized.value = true
      isInitializing.value = false
    }
  }

  /**
   * 认证初始化（页面刷新 / 应用启动时调用）
   *
   * 未完成初始化前不能把用户判定为未登录，路由守卫会等待该 Promise。
   */
  function initialize(): Promise<void> {
    if (initialized.value) return Promise.resolve()

    initializePromise ??= runInitialize().finally(() => {
      initializePromise = null
    })

    return initializePromise
  }

  // 静默刷新成功后由请求层 emit 事件，这里只负责同步响应式状态
  onSessionRefreshed((result) => {
    setSession(result.accessToken, result.user)
  })

  return {
    accessToken,
    user,
    isInitializing,
    initialized,
    isAuthenticated,
    roles,
    setSession,
    clearSession,
    login,
    register,
    logout,
    fetchMe,
    initialize,
  }
})
