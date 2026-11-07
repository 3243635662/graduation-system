import type { AuthUser } from '@graduation/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services/api/auth.api', () => ({
  login: vi.fn(),
  register: vi.fn(),
  refresh: vi.fn(),
  getMe: vi.fn(),
  logout: vi.fn(),
}))

import pinia from '@/plugins/pinia/setup'
import { useAuthStore } from '@/stores/auth'
import type { Router } from 'vue-router'

import { setupAuthGuard } from '../auth-guard'

interface RouteLike {
  path: string
  fullPath: string
  query?: Record<string, string>
}

const studentUser: AuthUser = {
  id: 'user-1',
  email: 'student@example.com',
  displayName: '张三',
  status: 'ACTIVE',
  roles: [{ id: 'role-1', code: 'STUDENT', name: '学生' }],
}

function createGuard() {
  let handler: ((to: RouteLike) => unknown) | undefined

  const router = {
    beforeEach: (fn: (to: RouteLike) => unknown) => {
      handler = fn
    },
  }

  setupAuthGuard(router as unknown as Router)

  return (to: RouteLike) => {
    if (!handler) throw new Error('guard not registered')
    return handler({ query: {}, ...to })
  }
}

describe('auth guard', () => {
  let store: ReturnType<typeof useAuthStore>

  beforeEach(() => {
    store = useAuthStore(pinia)
    store.clearSession()
    vi.spyOn(store, 'initialize').mockResolvedValue()
  })

  it('未登录访问业务页面跳转登录页并记录目标地址', async () => {
    const navigate = createGuard()

    await expect(navigate({ path: '/dashboard', fullPath: '/dashboard' })).resolves.toEqual({
      path: '/auth/sign-in',
      query: { redirect: '/dashboard' },
    })

    expect(store.initialize).toHaveBeenCalled()
  })

  it('已登录访问登录页跳转工作台', async () => {
    store.setSession('access-token', studentUser)
    const navigate = createGuard()

    await expect(navigate({ path: '/auth/sign-in', fullPath: '/auth/sign-in' })).resolves.toBe(
      '/dashboard',
    )
  })

  it('已登录访问业务页面放行', async () => {
    store.setSession('access-token', studentUser)
    const navigate = createGuard()

    await expect(navigate({ path: '/dashboard', fullPath: '/dashboard' })).resolves.toBe(true)
  })

  it('未登录访问错误页放行（可正常进入 404）', async () => {
    const navigate = createGuard()

    await expect(navigate({ path: '/errors/404', fullPath: '/errors/404' })).resolves.toBe(true)
  })

  it('未登录访问登录页放行', async () => {
    const navigate = createGuard()

    await expect(navigate({ path: '/auth/sign-in', fullPath: '/auth/sign-in' })).resolves.toBe(true)
  })
})
