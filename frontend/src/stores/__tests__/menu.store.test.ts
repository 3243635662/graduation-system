import type { MenuTreeNode } from '@graduation/shared'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/services/api/menus.api', () => ({
  getCurrentMenus: vi.fn(),
}))

import { getCurrentMenus } from '@/services/api/menus.api'

import { useMenuStore } from '../menu'

const studentMenus: MenuTreeNode[] = [
  {
    id: 'menu-dashboard',
    code: 'DASHBOARD',
    title: '工作台',
    path: '/dashboard',
    type: 'PAGE',
    icon: 'LayoutDashboard',
    componentKey: 'dashboard/index',
    sortOrder: 1,
  },
  {
    id: 'menu-graduation',
    code: 'GRADUATION',
    title: '毕业设计管理',
    path: null,
    type: 'DIRECTORY',
    icon: 'GraduationCap',
    sortOrder: 10,
    children: [
      {
        id: 'menu-topics',
        code: 'TOPIC_CENTER',
        title: '课题中心',
        path: '/topics',
        type: 'PAGE',
        icon: 'BookOpen',
        componentKey: 'topics/index',
        sortOrder: 1,
      },
    ],
  },
]

describe('menu store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(getCurrentMenus).mockReset()
  })

  it('加载当前用户菜单并派生侧边栏分组', async () => {
    vi.mocked(getCurrentMenus).mockResolvedValue(studentMenus)

    const store = useMenuStore()

    expect(store.loaded).toBe(false)

    const tree = await store.load()

    expect(tree).toHaveLength(2)
    expect(store.loaded).toBe(true)
    // 目录下的直接页面归入以目录名命名的分组
    expect(store.navGroups.map((group) => group.title)).toEqual(['工作台', '毕业设计管理'])
    expect(store.pages.map((page) => page.code)).toEqual(['DASHBOARD', 'TOPIC_CENTER'])
  })

  it('已加载后不会重复请求菜单接口', async () => {
    vi.mocked(getCurrentMenus).mockResolvedValue(studentMenus)

    const store = useMenuStore()

    await store.load()
    await store.load()

    expect(getCurrentMenus).toHaveBeenCalledTimes(1)
  })

  it('并发调用共享同一个请求', async () => {
    vi.mocked(getCurrentMenus).mockResolvedValue(studentMenus)

    const store = useMenuStore()

    await Promise.all([store.load(), store.load(), store.load()])

    expect(getCurrentMenus).toHaveBeenCalledTimes(1)
  })

  it('菜单接口失败时不标记为已加载，异常向上抛出', async () => {
    vi.mocked(getCurrentMenus).mockRejectedValue(new Error('接口不可用'))

    const store = useMenuStore()

    await expect(store.load()).rejects.toThrow('接口不可用')
    expect(store.loaded).toBe(false)
    expect(store.menuTree).toEqual([])
  })

  it('reset 后丢弃在途请求的结果，避免切换用户时串菜单', async () => {
    let resolveMenus: ((menus: MenuTreeNode[]) => void) | undefined

    vi.mocked(getCurrentMenus).mockImplementation(
      () =>
        new Promise<MenuTreeNode[]>((resolve) => {
          resolveMenus = resolve
        }),
    )

    const store = useMenuStore()
    const task = store.load()

    await vi.waitUntil(() => Boolean(resolveMenus))

    store.reset()
    resolveMenus?.(studentMenus)

    await task

    expect(store.menuTree).toEqual([])
    expect(store.loaded).toBe(false)
  })

  it('重复菜单按 id 去重', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    vi.mocked(getCurrentMenus).mockResolvedValue([studentMenus[0]!, studentMenus[0]!])

    const store = useMenuStore()

    await store.load()

    expect(store.menuTree).toHaveLength(1)
    errorSpy.mockRestore()
  })
})
