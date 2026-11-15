import type { MenuTreeNode } from '@graduation/shared'

/**
 * Redis 中缓存的菜单负载
 *
 * 只包含渲染导航所需的公开数据：
 * 不含 Access/Refresh Token、密码哈希、SMTP/Redis 密钥或任何用户隐私字段。
 */
export interface CachedMenuEntry {
  /** 负载结构版本，与 MENU_CACHE_SCHEMA_VERSION 一致 */
  schemaVersion: number
  /** 缓存归属用户，命中时必须与当前用户一致 */
  userId: string
  /** 生成时间（ISO 字符串） */
  generatedAt: string
  /** 该用户计算后的完整菜单树 */
  menus: MenuTreeNode[]
}

/**
 * 菜单计算所需的数据库行（仅取必要字段）
 *
 * 使用宽松的 string 类型而不是 Prisma 枚举，
 * 以便单元测试直接构造数据，也避免与生成客户端的枚举类型强耦合。
 */
export interface MenuQueryRow {
  id: string
  code: string
  title: string
  path: string | null
  componentKey: string | null
  icon: string | null
  type: string
  parentId: string | null
  sortOrder: number
  visible: boolean
  status: string
}
