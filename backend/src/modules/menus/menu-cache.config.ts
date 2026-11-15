import {
  DEFAULT_MENU_CACHE_KEY_PREFIX,
  MENU_CACHE_TTL_JITTER_SECONDS,
  MENU_CACHE_TTL_SECONDS,
  buildMenuCacheKey,
  buildMenuCacheVersionKey,
} from '@graduation/shared'

/** 菜单缓存运行时配置（由 MENU_CACHE_KEY_PREFIX 覆盖前缀，便于测试隔离） */
export interface MenuCacheConfig {
  /** Key 前缀，默认 cache:rbac:menus */
  keyPrefix: string
  /** 全局 generation Key（无 TTL） */
  versionKey: string
  /** 基础 TTL（秒） */
  ttlSeconds: number
  /** TTL 随机抖动上限（秒） */
  ttlJitterSeconds: number
  /** 单用户菜单缓存 Key */
  buildKey: (generation: number, userId: string) => string
}

/** 注入令牌：允许测试直接注入自定义配置，无需读环境变量 */
export const MENU_CACHE_CONFIG = Symbol('MENU_CACHE_CONFIG')

/**
 * 从环境变量读取菜单缓存配置。
 *
 * 与项目其它配置保持一致：不引入 @nestjs/config，直接读 process.env。
 */
export function loadMenuCacheConfig(env: NodeJS.ProcessEnv = process.env): MenuCacheConfig {
  const keyPrefix = env['MENU_CACHE_KEY_PREFIX']?.trim() || DEFAULT_MENU_CACHE_KEY_PREFIX

  return {
    keyPrefix,
    versionKey: buildMenuCacheVersionKey(keyPrefix),
    ttlSeconds: MENU_CACHE_TTL_SECONDS,
    ttlJitterSeconds: MENU_CACHE_TTL_JITTER_SECONDS,
    buildKey: (generation: number, userId: string) =>
      buildMenuCacheKey(generation, userId, keyPrefix),
  }
}
