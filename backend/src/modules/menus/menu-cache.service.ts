import { MENU_CACHE_SCHEMA_VERSION } from '@graduation/shared'
import type { MenuTreeNode } from '@graduation/shared'
import { Inject, Injectable, Logger } from '@nestjs/common'

import { RedisService } from '../../common/redis/redis.service.js'
import { readOrInitGeneration } from './menu-cache-generation.js'
import { MENU_CACHE_CONFIG, type MenuCacheConfig } from './menu-cache.config.js'
import { parseCachedMenuEntry } from './schemas/menu.schema.js'
import type { CachedMenuEntry } from './types/menu-cache.type.js'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 菜单缓存（Cache Aside）
 *
 * 设计要点：
 * 1. 每个用户单独缓存完整菜单树，Key 带全局 generation，版本提升后旧 Key 逻辑失效。
 * 2. Redis 是「可选加速层」：任何 Redis 异常都降级为直接查库，绝不让菜单接口 503。
 * 3. 进程内 Singleflight：同一用户的并发未命中请求共享一次数据库查询。
 * 4. 缓存只承载 UI 导航数据，不能作为业务接口的授权依据。
 */
@Injectable()
export class MenuCacheService {
  private readonly logger = new Logger(MenuCacheService.name)

  /** 进程内 Singleflight：userId -> 正在进行的查询 Promise */
  private readonly inflight = new Map<string, Promise<MenuTreeNode[]>>()

  constructor(
    private readonly redisService: RedisService,
    @Inject(MENU_CACHE_CONFIG) private readonly config: MenuCacheConfig,
  ) {}

  /**
   * 读取缓存，未命中则调用 build 回源并写回缓存。
   *
   * build 抛错时不会写入任何缓存，异常原样向上传递。
   */
  getOrBuild(
    userId: string,
    build: () => Promise<MenuTreeNode[]>,
    ttlSeconds?: number,
  ): Promise<MenuTreeNode[]> {
    const running = this.inflight.get(userId)

    if (running) return running

    const task = this.loadWithCache(userId, build, ttlSeconds).finally(() => {
      // 只有仍指向本次任务时才清理，避免误删后续请求的 Promise
      if (this.inflight.get(userId) === task) {
        this.inflight.delete(userId)
      }
    })

    this.inflight.set(userId, task)

    return task
  }

  /**
   * 读取全局 generation。
   *
   * 返回 null 表示 Redis 当前不可用（或版本号无法确定），调用方应绕过缓存直接查库。
   */
  async readGeneration(): Promise<number | null> {
    try {
      const client = this.redisService.getClient()

      // Key 不存在时用随机种子初始化，绝不使用固定值：
      // 固定初值会让「版本 Key 丢失后重新初始化」重新落到历史世代名上，
      // 从而命中尚未过期的旧菜单缓存。
      const raw = await readOrInitGeneration(client, this.config.versionKey)

      if (raw === null) {
        this.logger.warn('菜单缓存版本号初始化竞争失败，本次降级为直连数据库')

        return null
      }

      return this.parseGeneration(raw)
    } catch (error) {
      this.logger.warn(`读取菜单缓存版本失败，已降级为直连数据库：${errorMessage(error)}`)

      return null
    }
  }

  /** 读取并校验单用户菜单缓存，任何异常都视为未命中 */
  async read(userId: string, generation: number): Promise<MenuTreeNode[] | null> {
    const key = this.config.buildKey(generation, userId)

    let raw: string | null

    try {
      raw = await this.redisService.getClient().get(key)
    } catch (error) {
      this.logger.warn(`读取菜单缓存失败，已降级为直连数据库：${errorMessage(error)}`)

      return null
    }

    if (raw === null) return null

    const entry = parseCachedMenuEntry(raw)

    if (!entry || entry.userId !== userId) {
      // 缓存损坏或串号：删除当前 Key 后回源，绝不返回其他用户的数据
      this.logger.warn(
        `菜单缓存校验失败，已删除并回源（user=${userId}, key=${key}, reason=${
          entry ? 'userId 不匹配' : 'JSON 非法或结构/版本不符'
        }）`,
      )
      await this.safeDelete(key)

      return null
    }

    return entry.menus
  }

  /** 写入单用户菜单缓存；失败只记录日志，不影响已完成的数据库查询结果 */
  async write(
    userId: string,
    generation: number,
    menus: MenuTreeNode[],
    ttlLimitSeconds?: number,
  ): Promise<boolean> {
    const key = this.config.buildKey(generation, userId)

    const entry: CachedMenuEntry = {
      schemaVersion: MENU_CACHE_SCHEMA_VERSION,
      userId,
      generatedAt: new Date().toISOString(),
      menus,
    }

    // 有资格到期时间时不得加抖动，否则可能超过最近到期时间
    const ttlSeconds =
      ttlLimitSeconds === undefined
        ? this.config.ttlSeconds + Math.floor(Math.random() * (this.config.ttlJitterSeconds + 1))
        : Math.max(1, Math.min(ttlLimitSeconds, this.config.ttlSeconds))

    try {
      await this.redisService.getClient().set(key, JSON.stringify(entry), { EX: ttlSeconds })

      return true
    } catch (error) {
      this.logger.warn(`写入菜单缓存失败（不影响本次响应）：${errorMessage(error)}`)

      return false
    }
  }

  /** 删除指定 generation 下的用户缓存（仅在缓存内容非法时使用） */
  async safeDelete(key: string): Promise<void> {
    try {
      await this.redisService.getClient().del(key)
    } catch (error) {
      this.logger.warn(`删除菜单缓存失败：${errorMessage(error)}`)
    }
  }

  private parseGeneration(raw: string): number | null {
    const value = Number(raw)

    if (!Number.isInteger(value) || value < 0) {
      // 版本号被外部改坏时不能猜一个值：按 0 处理可能命中上一轮遗留的 g0 缓存。
      // 这里直接绕过缓存，宁可多查一次数据库，也不返回可疑的陈旧菜单。
      this.logger.error(
        `菜单缓存版本号非法（${raw}），已绕过缓存直连数据库，请检查 ${this.config.versionKey}`,
      )

      return null
    }

    return value
  }

  private async loadWithCache(
    userId: string,
    build: () => Promise<MenuTreeNode[]>,
    ttlSeconds?: number,
  ): Promise<MenuTreeNode[]> {
    let generation = await this.readGeneration()

    if (generation === null) {
      // Redis 不可用：绕过缓存直接回源，绝不用默认菜单兜底
      return build()
    }

    // 最多重试一次：命中后若发现版本已变化，丢弃旧结果并按新版本重新读取
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const cached = await this.read(userId, generation)

      if (cached) {
        const latest = await this.readGeneration()

        // 版本读取失败时保留已通过校验的命中结果，避免无意义的重复查询
        if (latest === null || latest === generation) return cached

        generation = latest

        continue
      }

      const menus = await build()

      await this.write(userId, generation, menus, ttlSeconds)

      return menus
    }

    // 版本在极短时间内持续变化：直接返回数据库结果，本次不写缓存
    return build()
  }
}
