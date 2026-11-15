/**
 * 菜单缓存常量（后端运行时与 Seed 脚本共用）
 *
 * Key 设计：
 *   cache:rbac:menus:version                              -> 全局 generation（长期存在，无 TTL）
 *   cache:rbac:menus:v1:g{generation}:user:{userId}       -> 某用户在当前 generation 下的菜单树
 *
 * 失效方式：INCR 全局 generation，所有旧 generation 的 Key 逻辑失效，由 TTL 自然回收。
 * 严禁使用 KEYS / FLUSHDB 批量清理。
 *
 * 注意：generation 的初始值由后端随机生成（不可复用），
 * 避免版本 Key 丢失后重新初始化时与历史世代撞号、命中尚未过期的旧缓存。
 */

/** 缓存负载结构版本，结构变更时必须升级，避免读到旧格式 */
export const MENU_CACHE_SCHEMA_VERSION = 1

/** 默认 Key 前缀，可通过 MENU_CACHE_KEY_PREFIX 覆盖（测试隔离用） */
export const DEFAULT_MENU_CACHE_KEY_PREFIX = 'cache:rbac:menus'

/** 缓存基础有效期（秒） */
export const MENU_CACHE_TTL_SECONDS = 600

/** 随机抖动上限（秒），用于打散同一批 Key 的过期时间，避免同时击穿 */
export const MENU_CACHE_TTL_JITTER_SECONDS = 60

/** 全局版本号 Key */
export function buildMenuCacheVersionKey(prefix: string = DEFAULT_MENU_CACHE_KEY_PREFIX): string {
  return `${prefix}:version`
}

/** 单用户菜单缓存 Key */
export function buildMenuCacheKey(
  generation: number,
  userId: string,
  prefix: string = DEFAULT_MENU_CACHE_KEY_PREFIX,
): string {
  return `${prefix}:v${MENU_CACHE_SCHEMA_VERSION}:g${generation}:user:${userId}`
}
