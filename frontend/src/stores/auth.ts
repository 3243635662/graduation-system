import { setAccessToken } from '@/lib/access-token'
import { onSessionRefreshed } from '@/lib/auth-events'
import * as authApi from '@/services/api/auth.api'
import * as usersApi from '@/services/api/users.api'
import type {
  AuthUser,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
  UpdateMyProfileInput,
} from '@graduation/shared'
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

  /** 用接口返回的最新资料替换当前用户（邮箱换绑成功后使用） */
  function setUser(nextUser: AuthUser): void {
    user.value = nextUser
  }

  /**
   * 修改本人资料
   *
   * 先浅合并更新后的字段，再调用 fetchMe 获取最新的完整 AuthUser（包含 roles 与 permissions），
   * 确保左侧名片、侧边栏头像与姓名即时响应且角色授权不丢失。
   */
  async function updateProfile(input: UpdateMyProfileInput): Promise<AuthUser> {
    const nextUser = await usersApi.updateMyProfile(input)
    if (user.value) {
      user.value = {
        ...user.value,
        ...nextUser,
      }
    } else {
      user.value = nextUser
    }

    try {
      return await fetchMe()
    } catch {
      return user.value as AuthUser
    }
  }

  /**
   * 通过邮箱验证码修改/重置密码
   *
   * 密码修改成功后后端会销毁会话，前端主动清理 Session，引导用户重新登录。
   */
  async function resetPassword(input: ResetPasswordInput): Promise<{ message: string }> {
    const result = await authApi.resetPassword(input)
    clearSession()

    return result
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
    setUser,
    updateProfile,
    resetPassword,
    initialize,
  }
})
