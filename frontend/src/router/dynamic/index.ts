/**
 * 动态路由 / 菜单树工具集合
 *
 * 注意：这里刻意不再 re-export DEFAULT_MENU_TREE。
 * 运行时菜单只能来自 GET /api/menus/current，默认菜单树仅用于后端 Seed 与测试。
 */
export * from './bootstrap'
export * from './component-registry'
export * from './nav'
export * from './routes'
