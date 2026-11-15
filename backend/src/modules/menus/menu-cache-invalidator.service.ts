import { Inject, Injectable, Logger } from '@nestjs/common'

import { RedisService } from '../../common/redis/redis.service.js'
import { readOrInitGeneration } from './menu-cache-generation.js'
import { MENU_CACHE_CONFIG, type MenuCacheConfig } from './menu-cache.config.js'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 菜单缓存失效
 *
 * 采用全局 generation 版本号：任何影响用户有效菜单的数据变更提交后，
 * INCR 一次版本号，所有旧 generation 的 Key 逻辑失效并由 TTL 自然回收。
 *
 * 明确禁止：
 * - KEYS cache:rbac:menus:* 批量扫描删除
 * - FLUSHDB / FLUSHALL
 *
 * 唯一入口：所有写菜单/角色/用户角色关系的业务 Service 都调用本服务，
 * 不允许在 Controller 里直接操作 Redis。
 */
@Injectable()
export class MenuCacheInvalidatorService {
  private readonly logger = new Logger(MenuCacheInvalidatorService.name)

  constructor(
    private readonly redisService: RedisService,
    @Inject(MENU_CACHE_CONFIG) private readonly config: MenuCacheConfig,
  ) {}

  /**
   * 提升全局 generation，使所有旧菜单缓存失效。
   *
   * 必须在数据库事务提交成功之后调用。
   * 返回 false 表示 Redis 失效失败：此时数据库已提交，不能抛错让调用方误判业务失败，
   * 但必须留下明确的 error 级日志，并依赖 TTL（600～660 秒）作为有限兜底。
   */
  async invalidate(reason: string): Promise<boolean> {
    try {
      const client = this.redisService.getClient()

      // 先确保版本 Key 存在：直接 INCR 一个不存在的 Key 会把它固定创建为 1，
      // 版本 Key 丢失后重新初始化就会与历史 g1 缓存撞号。
      const current = await readOrInitGeneration(client, this.config.versionKey)

      if (current === null) {
        throw new Error('菜单缓存版本号无法初始化')
      }

      const generation = await client.incr(this.config.versionKey)

      this.logger.log(`菜单缓存已失效：generation=${generation}（原因：${reason}）`)

      return true
    } catch (error) {
      this.logger.error(
        `[需要人工关注] 菜单缓存失效失败（原因：${reason}）：${errorMessage(error)}。` +
          '数据库已提交，旧 generation 缓存最长会在 TTL 过期后被回收；' +
          `请重试 invalidate() 或检查 Redis 连接（versionKey=${this.config.versionKey}）`,
      )

      return false
    }
  }

  /**
   * 「事务提交成功后再失效」的统一用法。
   *
   * 事务抛错时不会提升版本号，保证失败的写操作不会让所有用户的缓存白白失效。
   *
   * @example
   * await invalidator.commitThenInvalidate('roleMenu.create', () =>
   *   this.prisma.$transaction(async (tx) => { ... }),
   * )
   */
  async commitThenInvalidate<T>(reason: string, run: () => Promise<T>): Promise<T> {
    const result = await run()

    await this.invalidate(reason)

    return result
  }
}
