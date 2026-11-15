import type { AuthUser, MenuTreeNode } from '@graduation/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services/api/auth.api', () => ({
  login: vi.fn(),
  register: vi.fn(),
  refresh: vi.fn(),
  getMe: vi.fn(),
  logout: vi.fn(),
}))

vi.mock('@/services/api/menus.api', () => ({
  getCurrentMenus: vi.fn(),
}))

import pinia from '@/plugins/pinia/setup'
import { resetDynamicRouting } from '@/router/dynamic/bootstrap'
import { getCurrentMenus } from '@/services/api/menus.api'
import { useAuthStore } from '@/stores/auth'
import { useMenuStore } from '@/stores/menu'
import type { RouteRecordRaw, Router } from 'vue-router'

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

const studentMenus: MenuTreeNode[] = [
  {
    code: 'DASHBOARD',
    title: '工作台',
    path: '/dashboard',
    type: 'PAGE',
    componentKey: 'dashboard/index',
    sortOrder: 1,
  },
]

function createGuard() {
  let handler: ((to: RouteLike) => unknown) | undefined

  const registered = new Map<string, RouteRecordRaw>()

  const router = {
    beforeEach: (fn: (to: RouteLike) => unknown) => {
      handler = fn
    },
    hasRoute: (name: string | symbol) => registered.has(String(name)),
    addRoute: (route: RouteRecordRaw) => {
      registered.set(String(route.name), route)

      return () => {
        registered.delete(String(route.name))
      }
    },
  }

  setupAuthGuard(router as unknown as Router)

  return {
    registered,
    navigate: (to: RouteLike) => {
      if (!handler) throw new Error('guard not registered')
      return handler({ query: {}, ...to })
    },
  }
}

describe('auth guard', () => {
  let store: ReturnType<typeof useAuthStore>

  beforeEach(() => {
    store = useAuthStore(pinia)
    store.clearSession()
    vi.spyOn(store, 'initialize').mockResolvedValue()

    // 清理模块级动态路由状态，避免用例之间互相影响
    resetDynamicRouting(useMenuStore(pinia))
    vi.mocked(getCurrentMenus).mockReset()
    vi.mocked(getCurrentMenus).mockResolvedValue(studentMenus)
  })

  it('未登录访问业务页面跳转登录页并记录目标地址', async () => {
    const { navigate } = createGuard()

    await expect(navigate({ path: '/dashboard', fullPath: '/dashboard' })).resolves.toEqual({
      path: '/auth/sign-in',
      query: { redirect: '/dashboard' },
    })

    expect(store.initialize).toHaveBeenCalled()
    expect(getCurrentMenus).not.toHaveBeenCalled()
  })

  it('已登录访问登录页跳转工作台', async () => {
    store.setSession('access-token', studentUser)
    const { navigate } = createGuard()

    await expect(navigate({ path: '/auth/sign-in', fullPath: '/auth/sign-in' })).resolves.toBe(
      '/dashboard',
    )
  })

  it('已登录首次访问业务页面：注册动态路由并重新匹配目标地址', async () => {
    store.setSession('access-token', studentUser)
    const { navigate, registered } = createGuard()

    // 第一次导航：本次才完成注册，需要按新路由重新导航
    await expect(navigate({ path: '/dashboard', fullPath: '/dashboard' })).resolves.toBe(
      '/dashboard',
    )
    expect([...registered.keys()]).toEqual(['DASHBOARD'])
    expect(getCurrentMenus).toHaveBeenCalledTimes(1)

    // 第二次导航：路由已就绪，直接放行
    await expect(navigate({ path: '/dashboard', fullPath: '/dashboard' })).resolves.toBe(true)
    expect(getCurrentMenus).toHaveBeenCalledTimes(1)
  })

  it('菜单接口失败时放行但不注册任何业务路由（不回退默认菜单）', async () => {
    store.setSession('access-token', studentUser)
    vi.mocked(getCurrentMenus).mockRejectedValueOnce(new Error('菜单接口不可用'))

    const { navigate, registered } = createGuard()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(navigate({ path: '/dashboard', fullPath: '/dashboard' })).resolves.toBe(true)
    expect(registered.size).toBe(0)

    errorSpy.mockRestore()
  })

  it('未登录访问错误页放行（可正常进入 404）', async () => {
    const { navigate } = createGuard()

    await expect(navigate({ path: '/errors/404', fullPath: '/errors/404' })).resolves.toBe(true)
  })

  it('未登录访问登录页放行', async () => {
    const { navigate } = createGuard()

    await expect(navigate({ path: '/auth/sign-in', fullPath: '/auth/sign-in' })).resolves.toBe(true)
  })

  it('退出登录后再次访问业务页面会被清理并跳转登录页', async () => {
    store.setSession('access-token', studentUser)
    const { navigate, registered } = createGuard()

    await navigate({ path: '/dashboard', fullPath: '/dashboard' })
    expect(registered.size).toBe(1)

    store.clearSession()
    resetDynamicRouting(useMenuStore(pinia))

    await expect(navigate({ path: '/dashboard', fullPath: '/dashboard' })).resolves.toEqual({
      path: '/auth/sign-in',
      query: { redirect: '/dashboard' },
    })
    expect(registered.size).toBe(0)
  })
})
