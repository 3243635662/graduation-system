import { dedupeMenuTree, flattenPages, toNavGroups } from '@/router/dynamic/nav'
import { getCurrentMenus } from '@/services/api/menus.api'
import type { MenuTreeNode } from '@graduation/shared'
import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'

/**
 * 当前用户菜单
 *
 * - 运行时菜单唯一来源是 GET /api/menus/current，不回退到 DEFAULT_MENU_TREE
 * - 只保存在内存（Pinia），不写入 localStorage 作为可信授权数据
 * - load() 单飞：并发调用共享同一个请求
 * - reset() 递增内部 epoch，使退出登录前发出的在途请求不会污染新用户状态
 */
export const useMenuStore = defineStore('menu', () => {
  const menuTree = shallowRef<MenuTreeNode[]>([])
  const loaded = ref(false)
  const isLoading = ref(false)

  /** 侧边栏分组（由菜单树派生） */
  const navGroups = computed(() => toNavGroups(menuTree.value))

  /** 全部页面节点（供搜索面板使用） */
  const pages = computed(() => flattenPages(menuTree.value))

  let loadPromise: Promise<MenuTreeNode[]> | null = null
  let epoch = 0

  function setMenus(tree: MenuTreeNode[]): void {
    menuTree.value = dedupeMenuTree(tree)
    loaded.value = true
  }

  /** 清空菜单状态（退出登录 / 认证过期 / 切换用户） */
  function reset(): void {
    epoch += 1
    loadPromise = null
    menuTree.value = []
    loaded.value = false
    isLoading.value = false
  }

  /**
   * 拉取当前用户菜单
   *
   * 已加载且未强制刷新时直接返回内存数据；
   * 请求失败时异常向上抛出，由调用方决定如何降级（绝不回退默认菜单）。
   */
  async function load(force = false): Promise<MenuTreeNode[]> {
    if (loaded.value && !force) return menuTree.value
    if (loadPromise) return loadPromise

    const runEpoch = epoch

    isLoading.value = true

    const task = (async () => {
      try {
        const tree = await getCurrentMenus()

        // 期间发生过 reset（退出/切换用户）：丢弃这次结果，不返回旧用户的数据
        if (runEpoch !== epoch) return menuTree.value

        setMenus(tree)

        return menuTree.value
      } finally {
        if (runEpoch === epoch) {
          loadPromise = null
          isLoading.value = false
        }
      }
    })()

    loadPromise = task

    return task
  }

  return {
    menuTree,
    loaded,
    isLoading,
    navGroups,
    pages,
    load,
    reset,
    setMenus,
  }
})
