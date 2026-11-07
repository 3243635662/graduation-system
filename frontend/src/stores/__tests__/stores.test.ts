import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useAuthStore } from '../auth'
import { useSidebarConfigStore } from '../sidebar-config'
import { useThemeStore } from '../theme'

describe('stores', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('updates auth state', () => {
    const authStore = useAuthStore()

    expect(authStore.isAuthenticated).toBe(false)
    expect(authStore.user).toBeNull()

    authStore.setSession('access-token', {
      id: 'user-1',
      email: 'student@example.com',
      displayName: '张三',
      status: 'ACTIVE',
      roles: [{ id: 'role-1', code: 'STUDENT', name: '学生' }],
    })

    expect(authStore.isAuthenticated).toBe(true)
    expect(authStore.user?.id).toBe('user-1')
    expect(authStore.roles[0]?.code).toBe('STUDENT')

    authStore.clearSession()

    expect(authStore.isAuthenticated).toBe(false)
    expect(authStore.user).toBeNull()
  })

  it('updates theme preferences', () => {
    const themeStore = useThemeStore()

    themeStore.setTheme('soft-pop')
    themeStore.setContentLayout('full')

    expect(themeStore.theme).toBe('soft-pop')
    expect(themeStore.contentLayout).toBe('full')
  })

  it('updates sidebar navigation mode', () => {
    const sidebarConfigStore = useSidebarConfigStore()

    expect(sidebarConfigStore.navigationMode).toBe('collapsible')

    sidebarConfigStore.setNavigationMode('vercel')

    expect(sidebarConfigStore.navigationMode).toBe('vercel')
  })
})
