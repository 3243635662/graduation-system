import { Logger } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RedisService } from '../../common/redis/redis.service.js'
import { MenuCacheInvalidatorService } from './menu-cache-invalidator.service.js'
import { loadMenuCacheConfig } from './menu-cache.config.js'

const KEY_PREFIX = 'test:rbac:menus'

function createRedisFake(overrides: { failIncr?: boolean } = {}) {
  const store = new Map<string, string>()

  return {
    store,
    getClient: () => ({
      get: async (key: string) => store.get(key) ?? null,
      set: async (key: string, value: string, options?: { NX?: boolean }) => {
        if (options?.NX && store.has(key)) return null

        store.set(key, value)

        return 'OK'
      },
      incr: async (key: string) => {
        if (overrides.failIncr) throw new Error('redis down')

        const next = Number(store.get(key) ?? '0') + 1

        store.set(key, String(next))

        return next
      },
    }),
  }
}

describe('MenuCacheInvalidatorService', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  function createService(redis: ReturnType<typeof createRedisFake>) {
    return new MenuCacheInvalidatorService(
      redis as unknown as RedisService,
      loadMenuCacheConfig({ MENU_CACHE_KEY_PREFIX: KEY_PREFIX }),
    )
  }

  it('版本 Key 缺失时先随机初始化再 INCR，不会固定成 1', async () => {
    const redis = createRedisFake()
    const service = createService(redis)

    await expect(service.invalidate('seed.sync')).resolves.toBe(true)

    const generation = Number(redis.store.get(`${KEY_PREFIX}:version`))

    // 初始值取 1 ~ 2^48-1 的随机整数，INCR 后必然 >= 2
    expect(Number.isInteger(generation)).toBe(true)
    expect(generation).toBeGreaterThan(1)
  })

  it('INCR 全局版本号使所有旧缓存失效', async () => {
    const redis = createRedisFake()
    const service = createService(redis)

    await expect(service.invalidate('roleMenu.create')).resolves.toBe(true)

    const first = Number(redis.store.get(`${KEY_PREFIX}:version`))

    expect(Number.isInteger(first)).toBe(true)

    await service.invalidate('menu.update')

    expect(Number(redis.store.get(`${KEY_PREFIX}:version`))).toBe(first + 1)
  })

  it('事务成功后才提升版本号', async () => {
    const redis = createRedisFake()
    const service = createService(redis)

    const result = await service.commitThenInvalidate('menu.update', async () => 'ok')

    expect(result).toBe('ok')
    expect(Number(redis.store.get(`${KEY_PREFIX}:version`))).toBeGreaterThan(1)
  })

  it('事务失败时不提升版本号，异常原样抛出', async () => {
    const redis = createRedisFake()
    const service = createService(redis)

    await expect(
      service.commitThenInvalidate('menu.update', async () => {
        throw new Error('db failed')
      }),
    ).rejects.toThrow('db failed')

    expect(redis.store.get(`${KEY_PREFIX}:version`)).toBeUndefined()
  })

  it('Redis 失效失败时记录 error 日志且不抛出（数据库已提交）', async () => {
    const redis = createRedisFake({ failIncr: true })
    const service = createService(redis)
    const errorSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined)

    await expect(service.invalidate('userRole.delete')).resolves.toBe(false)

    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain('菜单缓存失效失败')
  })
})
