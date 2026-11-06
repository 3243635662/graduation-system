import type { MenuType } from '../enums/menu-type.js'

/**
 * 菜单树节点，前后端共用
 *
 * 字段与后端 Prisma Menu 模型保持一致：
 * code         -> 路由 name，同时作为菜单唯一标识
 * title        -> 菜单标题
 * path         -> 路由地址（DIRECTORY 节点为空）
 * icon         -> lucide 图标名（字符串，便于后端存储）
 * type         -> DIRECTORY（目录，无组件）/ PAGE（页面，必须有组件）
 * componentKey -> 对应前端 src/views 下的页面文件路径（不含 .vue 后缀）
 * sortOrder    -> 同级排序
 */
export interface MenuTreeNode {
  code: string
  title: string
  path: string | null
  type: MenuType
  icon?: string
  componentKey?: string
  sortOrder: number
  visible?: boolean
  children?: MenuTreeNode[]
}
