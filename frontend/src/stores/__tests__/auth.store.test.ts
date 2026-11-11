import type { AuthUser } from '@graduation/shared'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const authApi = vi.hoisted(() => ({
  login: vi.fn(),
  register: vi.fn(),
  refresh: vi.fn(),
  getMe: vi.fn(),
  logout: vi.fn(),
}))

vi.mock('@/services/api/auth.api', () => authApi)

import { getAccessToken, setAccessToken } from '@/lib/access-token'
import { emitSessionRefreshed } from '@/lib/auth-events'

import { useAuthStore } from '../auth'

const studentUser: AuthUser = {
  id: 'user-1',
  email: 'student@example.com',
  displayName: '张三',
  status: 'ACTIVE',
  roles: [{ id: 'role-1', code: 'STUDENT', name: '学生' }],
}

describe('auth store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    setAccessToken(null)
  })

  it('登录成功后保存会话与用户信息', async () => {
    authApi.login.mockResolvedValue({ accessToken: 'access-1', user: studentUser })

    const store = useAuthStore()
    const user = await store.login({ email: 'student@example.com', password: 'password123' })

    expect(user).toEqual(studentUser)
    expect(store.isAuthenticated).toBe(true)
    expect(store.accessToken).toBe('access-1')
    expect(store.roles[0]?.code).toBe('STUDENT')
    expect(getAccessToken()).toBe('access-1')
  })

  it('登录失败时不改变认证状态', async () => {
    authApi.login.mockRejectedValue(new Error('邮箱或密码错误'))

    const store = useAuthStore()

    await expect(store.login({ email: 'student@example.com', password: 'wrong' })).rejects.toThrow(
      '邮箱或密码错误',
    )

    expect(store.isAuthenticated).toBe(false)
    expect(store.user).toBeNull()
  })

  it('注册成功后直接进入登录态，并把验证码一起提交', async () => {
    authApi.register.mockResolvedValue({ accessToken: 'access-2', user: studentUser })

    const store = useAuthStore()
    await store.register({
      displayName: '张三',
      email: 'student@example.com',
      emailCode: '123456',
      password: 'password123',
      confirmPassword: 'password123',
    })

    expect(authApi.register).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'student@example.com', emailCode: '123456' }),
    )
    expect(store.isAuthenticated).toBe(true)
    expect(store.accessToken).toBe('access-2')
  })

  it('验证码错误时注册失败且不进入登录态', async () => {
    authApi.register.mockRejectedValue(new Error('邮箱验证码不正确'))

    const store = useAuthStore()

    await expect(
      store.register({
        displayName: '张三',
        email: 'student@example.com',
        emailCode: '000000',
        password: 'password123',
        confirmPassword: 'password123',
      }),
    ).rejects.toThrow('邮箱验证码不正确')

    expect(store.isAuthenticated).toBe(false)
    expect(store.user).toBeNull()
  })

  it('收到请求层的刷新事件后同步会话状态', () => {
    const store = useAuthStore()

    emitSessionRefreshed({ accessToken: 'bridged-token', user: studentUser })

    expect(store.isAuthenticated).toBe(true)
    expect(store.accessToken).toBe('bridged-token')
    expect(store.user).toEqual(studentUser)
    expect(getAccessToken()).toBe('bridged-token')
  })

  it('刷新页面后通过 refresh 恢复会话', async () => {
    authApi.refresh.mockResolvedValue({ accessToken: 'restored', user: studentUser })

    const store = useAuthStore()
    await store.initialize()

    expect(authApi.refresh).toHaveBeenCalledOnce()
    expect(store.isAuthenticated).toBe(true)
    expect(store.accessToken).toBe('restored')
    expect(store.initialized).toBe(true)
  })

  it('refresh 失败时保持未登录且不抛错', async () => {
    authApi.refresh.mockRejectedValue(new Error('刷新令牌无效或已过期'))

    const store = useAuthStore()
    await expect(store.initialize()).resolves.toBeUndefined()

    expect(store.isAuthenticated).toBe(false)
    expect(store.initialized).toBe(true)
    expect(store.isInitializing).toBe(false)
  })

  it('并发初始化只触发一次 refresh', async () => {
    authApi.refresh.mockResolvedValue({ accessToken: 'restored', user: studentUser })

    const store = useAuthStore()
    await Promise.all([store.initialize(), store.initialize(), store.initialize()])

    expect(authApi.refresh).toHaveBeenCalledOnce()
  })

  it('退出登录后清理全部认证状态', async () => {
    authApi.login.mockResolvedValue({ accessToken: 'access-1', user: studentUser })
    authApi.logout.mockResolvedValue(true)

    const store = useAuthStore()
    await store.login({ email: 'student@example.com', password: 'password123' })
    await store.logout()

    expect(authApi.logout).toHaveBeenCalledOnce()
    expect(store.isAuthenticated).toBe(false)
    expect(store.user).toBeNull()
    expect(getAccessToken()).toBeNull()
  })
})
