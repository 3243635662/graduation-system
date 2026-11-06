import type { NavGroup } from '@/components/app-sidebar/types'
import { DEFAULT_MENU_TREE, toNavGroups } from '@/router/dynamic'

/**
 * 侧边栏导航数据
 *
 * 菜单定义统一来自 @graduation/shared 的 DEFAULT_MENU_TREE，
 * 前端只负责把菜单树转换为导航展示结构。
 * 后端菜单接口接入后，用接口返回的树替换 DEFAULT_MENU_TREE 即可。
 */
export const navData: NavGroup[] = toNavGroups(DEFAULT_MENU_TREE)

/** 预留：非菜单树入口（外部链接、帮助中心等），V1 暂不启用 */
export const otherPages: NavGroup[] = []
