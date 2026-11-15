import { randomInt } from 'node:crypto'

import type { MenuTreeNode } from '@graduation/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RedisService } from '../../common/redis/redis.service.js'
import { loadMenuCacheConfig } from './menu-cache.config.js'
import { MenuCacheService } from './menu-cache.service.js'

// 让「初始化 generation」用的随机数可控，从而可以断言初始化结果与历史世代不撞号
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>()

  return { ...actual, randomInt: vi.fn(actual.randomInt) }
})

const KEY_PREFIX = 'test:rbac:menus'

/** 模拟版本 Key 丢失后重新初始化时拿到的随机种子 */
const RECOVERED_SEED = 123_456_789_012_345

interface SetOptions {
  EX?: number
  NX?: boolean
}

/**
 * 极简内存 Redis 客户端
 *
 * 只实现菜单缓存用到的 get / set / del / incr，
 * 并通过 versionSequence 支持「读取版本号期间版本被提升」的并发场景。
 */
class FakeRedisClient {
  isReady = true
  throwOnAll = false
  versionSequence: string[] = []

  readonly store = new Map<string, string>()
  readonly ttls = new Map<string, number>()
  readonly delCalls: string[] = []

  async get(key: string): Promise<string | null> {
    if (this.throwOnAll) throw new Error('redis down')

    if (key === `${KEY_PREFIX}:version` && this.versionSequence.length > 0) {
      return this.versionSequence.shift() ?? null
    }

    return this.store.get(key) ?? null
  }

  async set(key: string, value: string, options?: SetOptions): Promise<string | null> {
    if (this.throwOnAll) throw new Error('redis down')
    if (options?.NX && this.store.has(key)) return null

    this.store.set(key, value)

    if (options?.EX !== undefined) this.ttls.set(key, options.EX)

    return 'OK'
  }

  async del(key: string): Promise<number> {
    this.delCalls.push(key)

    return this.store.delete(key) ? 1 : 0
  }

  async incr(key: string): Promise<number> {
    if (this.throwOnAll) throw new Error('redis down')

    const next = Number(this.store.get(key) ?? '0') + 1

    this.store.set(key, String(next))

    return next
  }
}

const studentMenus: MenuTreeNode[] = [
  {
    code: 'DASHBOARD',
    title: '工作台',
    path: '/dashboard',
    type: 'PAGE',
    componentKey: 'dashboard/index',
    sortOrder: 1,
  },
]

describe('MenuCacheService', () => {
  let client: FakeRedisClient
  let service: MenuCacheService

  const build = () => Promise.resolve(studentMenus)

  beforeEach(() => {
    client = new FakeRedisClient()
    // 预置已知 generation，让多数用例可以稳定断言 g0 下的 Key；
    // 初始化行为本身由「版本 Key 不存在」等专门用例覆盖
    client.store.set(`${KEY_PREFIX}:version`, '0')
    service = new MenuCacheService(
      { getClient: () => client } as unknown as RedisService,
      loadMenuCacheConfig({ MENU_CACHE_KEY_PREFIX: KEY_PREFIX }),
    )
  })

  it('第一次请求未命中，回源后写入缓存', async () => {
    const builder = vi.fn(build)

    const menus = await service.getOrBuild('user-1', builder)

    expect(menus).toEqual(studentMenus)
    expect(builder).toHaveBeenCalledTimes(1)

    const key = `${KEY_PREFIX}:v1:g0:user:user-1`

    expect(client.store.has(key)).toBe(true)
  })

  it('缓存 TTL 落在 600～660 秒之间', async () => {
    await service.getOrBuild('user-1', build)

    const ttl = client.ttls.get(`${KEY_PREFIX}:v1:g0:user:user-1`) ?? 0

    expect(ttl).toBeGreaterThanOrEqual(600)
    expect(ttl).toBeLessThanOrEqual(660)
  })

  it('第二次请求命中缓存，不再回源', async () => {
    const builder = vi.fn(build)

    await service.getOrBuild('user-1', builder)
    await service.getOrBuild('user-1', builder)

    expect(builder).toHaveBeenCalledTimes(1)
  })

  it('缓存按 userId 隔离，不会读到其他用户的菜单', async () => {
    await service.getOrBuild('user-a', () => Promise.resolve(studentMenus))

    const adminMenus: MenuTreeNode[] = [
      {
        code: 'MENUS',
        title: '菜单管理',
        path: '/menus',
        type: 'PAGE',
        componentKey: 'menus/index',
        sortOrder: 9,
      },
    ]

    const builder = vi.fn(() => Promise.resolve(adminMenus))

    await expect(service.getOrBuild('user-b', builder)).resolves.toEqual(adminMenus)
    expect(builder).toHaveBeenCalledTimes(1)
    expect(client.store.has(`${KEY_PREFIX}:v1:g0:user:user-a`)).toBe(true)
    expect(client.store.has(`${KEY_PREFIX}:v1:g0:user:user-b`)).toBe(true)
  })

  it('缓存 JSON 损坏时删除 Key 并重新构建', async () => {
    const key = `${KEY_PREFIX}:v1:g0:user:user-1`

    client.store.set(key, '{not-json')
    client.store.set(`${KEY_PREFIX}:version`, '0')

    const builder = vi.fn(build)

    await expect(service.getOrBuild('user-1', builder)).resolves.toEqual(studentMenus)
    expect(builder).toHaveBeenCalledTimes(1)
    expect(client.delCalls).toContain(key)
  })

  it('缓存归属用户不匹配时丢弃并重新构建', async () => {
    const key = `${KEY_PREFIX}:v1:g0:user:user-1`

    client.store.set(
      key,
      JSON.stringify({
        schemaVersion: 1,
        userId: 'someone-else',
        generatedAt: new Date().toISOString(),
        menus: [],
      }),
    )
    client.store.set(`${KEY_PREFIX}:version`, '0')

    const builder = vi.fn(build)

    await expect(service.getOrBuild('user-1', builder)).resolves.toEqual(studentMenus)
    expect(builder).toHaveBeenCalled()
    expect(client.delCalls).toContain(key)
  })

  it('schemaVersion 不匹配时丢弃旧结构缓存', async () => {
    const key = `${KEY_PREFIX}:v1:g0:user:user-1`

    client.store.set(
      key,
      JSON.stringify({
        schemaVersion: 999,
        userId: 'user-1',
        generatedAt: new Date().toISOString(),
        menus: studentMenus,
      }),
    )
    client.store.set(`${KEY_PREFIX}:version`, '0')

    const builder = vi.fn(build)

    await service.getOrBuild('user-1', builder)

    expect(builder).toHaveBeenCalledTimes(1)
    expect(client.delCalls).toContain(key)
  })

  it('命中后版本号已提升时丢弃旧结果并按新版本重建', async () => {
    // 第一次读版本 -> 0（命中 g0），命中后复查版本 -> 1（必须丢弃）
    client.store.set(`${KEY_PREFIX}:version`, '0')
    client.store.set(
      `${KEY_PREFIX}:v1:g0:user:user-1`,
      JSON.stringify({
        schemaVersion: 1,
        userId: 'user-1',
        generatedAt: new Date().toISOString(),
        menus: studentMenus,
      }),
    )

    client.versionSequence = ['0', '1']

    const freshMenus: MenuTreeNode[] = [
      {
        code: 'TOPICS',
        title: '课题中心',
        path: '/topics',
        type: 'PAGE',
        componentKey: 'topics/index',
        sortOrder: 2,
      },
    ]

    const builder = vi.fn(() => Promise.resolve(freshMenus))

    await expect(service.getOrBuild('user-1', builder)).resolves.toEqual(freshMenus)
    expect(builder).toHaveBeenCalledTimes(1)
    expect(client.store.has(`${KEY_PREFIX}:v1:g1:user:user-1`)).toBe(true)
  })

  it('Redis 不可用时绕过缓存直接查库', async () => {
    client.throwOnAll = true

    const builder = vi.fn(build)

    await expect(service.getOrBuild('user-1', builder)).resolves.toEqual(studentMenus)
    expect(builder).toHaveBeenCalledTimes(1)
  })

  it('写入缓存失败不影响已完成的数据库查询结果', async () => {
    // 预置版本号，确保被拒绝的 SET 就是「写菜单缓存」这一步
    client.store.set(`${KEY_PREFIX}:version`, '0')

    const setSpy = vi.spyOn(client, 'set').mockRejectedValueOnce(new Error('set failed'))

    await expect(service.getOrBuild('user-1', build)).resolves.toEqual(studentMenus)

    expect(setSpy).toHaveBeenCalledTimes(1)
  })

  it('同一用户并发未命中只执行一次数据库查询（Singleflight）', async () => {
    let resolveBuild: ((menus: MenuTreeNode[]) => void) | undefined

    const deferred = new Promise<MenuTreeNode[]>((resolve) => {
      resolveBuild = resolve
    })

    const builder = vi.fn(() => deferred)

    const first = service.getOrBuild('user-1', builder)
    const second = service.getOrBuild('user-1', builder)

    expect(first).toBe(second)

    // 缓存未命中才会调用 builder，等它真正开始执行再放行
    await vi.waitUntil(() => builder.mock.calls.length > 0)

    resolveBuild?.(studentMenus)

    await expect(first).resolves.toEqual(studentMenus)
    expect(builder).toHaveBeenCalledTimes(1)
  })

  it('版本号被改坏时绕过缓存，不猜测 generation', async () => {
    client.store.set(`${KEY_PREFIX}:version`, 'not-a-number')

    const builder = vi.fn(build)

    await expect(service.getOrBuild('user-1', builder)).resolves.toEqual(studentMenus)
    expect(builder).toHaveBeenCalledTimes(1)
    expect(client.store.has(`${KEY_PREFIX}:v1:gNaN:user:user-1`)).toBe(false)
    expect(client.store.has(`${KEY_PREFIX}:v1:g0:user:user-1`)).toBe(false)
  })

  it('版本号 Key 不存在时用随机整数初始化，且不覆盖已有版本', async () => {
    client.store.delete(`${KEY_PREFIX}:version`)

    const generation = await service.readGeneration()

    expect(generation).not.toBeNull()
    expect(Number.isInteger(generation)).toBe(true)
    expect(generation).toBeGreaterThan(0)
    expect(client.store.get(`${KEY_PREFIX}:version`)).toBe(String(generation))

    // 已存在的版本号绝不被覆盖
    client.store.set(`${KEY_PREFIX}:version`, '7')

    await expect(service.readGeneration()).resolves.toBe(7)
  })

  it('版本 Key 丢失后重新初始化，旧 generation 缓存绝不会重新命中', async () => {
    const builder = vi.fn(build)

    // 1. g0 下生成 user-1 的缓存
    await service.getOrBuild('user-1', builder)

    expect(client.store.has(`${KEY_PREFIX}:v1:g0:user:user-1`)).toBe(true)

    // 2. 管理员修改菜单：版本提升到 g1，并写入新一代缓存
    await client.incr(`${KEY_PREFIX}:version`)
    await service.getOrBuild('user-1', builder)

    expect(client.store.has(`${KEY_PREFIX}:v1:g1:user:user-1`)).toBe(true)

    // 3. 版本 Key 被误删，但两代用户缓存都还没过期
    client.store.delete(`${KEY_PREFIX}:version`)

    expect(client.store.has(`${KEY_PREFIX}:v1:g0:user:user-1`)).toBe(true)
    expect(client.store.has(`${KEY_PREFIX}:v1:g1:user:user-1`)).toBe(true)

    // 4. 重新初始化 generation：必须是全新且不可复用的世代号
    //    受控注入随机种子，让「是否与历史世代撞号」的判断完全确定
    const randomIntMock = randomInt as unknown as { mockReturnValueOnce: (value: number) => void }

    randomIntMock.mockReturnValueOnce(RECOVERED_SEED)

    const regenerated = await service.readGeneration()

    expect(regenerated).toBe(RECOVERED_SEED)
    // 绝不能退回历史世代名（0 / 1），否则会命中上面那两代旧缓存
    expect(regenerated).not.toBe(0)
    expect(regenerated).not.toBe(1)

    // 5. 旧缓存绝不重新命中：必须回源，并写入新世代 Key
    builder.mockClear()

    await service.getOrBuild('user-1', builder)

    expect(builder).toHaveBeenCalledTimes(1)
    expect(client.store.has(`${KEY_PREFIX}:v1:g${RECOVERED_SEED}:user:user-1`)).toBe(true)
  })
})
