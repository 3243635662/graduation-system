import type { LucideProps } from '@lucide/vue'
import type { FunctionalComponent } from 'vue'

export type NavIcon = FunctionalComponent<LucideProps, Record<any, any>, any, Record<any, any>>

interface BaseNavItem {
  title: string
  icon?: NavIcon
}

export type NavItem =
  | (BaseNavItem & {
      items: NavSubItem[]
      url?: never
      isActive?: boolean
    })
  | (BaseNavItem & {
      url: string
      items?: never
    })

/**
 * A navigation entry as exposed by `useSidebarNavigation()`.
 * Covers top-level items and nested sub-items (whose `url` is optional).
 */
export type NavSubItem = BaseNavItem & {
  url?: string
  items?: NavSubItem[]
  isActive?: boolean
}

export interface NavGroup {
  title: string
  items: NavItem[]
}

export interface Team {
  name: string
  logo: NavIcon
  plan: string
}

/**
 * 侧边栏静态数据
 *
 * 主菜单由 useMenuStore().navGroups 提供（后端真实菜单），
 * 当前用户信息由 auth store 提供，这里只保留与账号无关的静态配置。
 */
export interface SidebarData {
  teams: Team[]
}
