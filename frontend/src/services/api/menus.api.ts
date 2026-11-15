import { apiRequest } from '@/lib/api-client'
import type { MenuTreeNode } from '@graduation/shared'

/**
 * 菜单接口封装
 *
 * 生产环境运行时菜单的唯一来源：由后端按当前登录用户的角色计算并返回。
 * 前端不得回退到 DEFAULT_MENU_TREE（该常量只用于 Seed 与测试）。
 *
 * 走统一的 apiRequest：自动附带 Access Token，40101 时静默刷新并重试一次。
 */
export function getCurrentMenus(): Promise<MenuTreeNode[]> {
  return apiRequest<MenuTreeNode[]>('/menus/current', {
    method: 'GET',
  })
}
