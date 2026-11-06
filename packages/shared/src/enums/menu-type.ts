/**
 * 菜单节点类型，与 Prisma 的 MenuType 枚举保持一致
 */
export const MenuType = {
  /** 目录：仅用于分组，不对应路由与页面组件 */
  DIRECTORY: 'DIRECTORY',
  /** 页面：对应一个路由与 src/views 下的页面组件 */
  PAGE: 'PAGE',
} as const

export type MenuType = (typeof MenuType)[keyof typeof MenuType]
