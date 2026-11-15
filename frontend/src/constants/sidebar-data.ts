import type { NavGroup } from '@/components/app-sidebar/types'

/**
 * 侧边栏非菜单入口
 *
 * 说明：主菜单（navGroups）已改为由 Pinia 的 menu store 提供，
 * 数据来源是后端 GET /api/menus/current，不再是编译期常量。
 */
export const otherPages: NavGroup[] = []
