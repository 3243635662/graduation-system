import { randomInt } from 'node:crypto'

/**
 * 全局 generation 的初始化
 *
 * 为什么不用固定的 0：
 *   假设 version Key 丢失前存在 g0:user:A / g0:user:B，
 *   若重新初始化又回到 0（INCR 场景下是 1），这些尚未过期的旧 Key
 *   会立刻重新变成「当前世代」，把变更前的旧菜单又服务出去。
 *
 * 因此初始值取密码学随机整数，让每次重新初始化都进入一个全新的命名空间，
 * 之后继续用 Redis INCR 单调递增。旧世代只能靠 TTL 自然回收。
 */

/** 随机上界 2^48：远小于 Number.MAX_SAFE_INTEGER 与 Redis 64 位整数上限，后续 INCR 不会溢出 */
export const GENERATION_SEED_UPPER_BOUND = 2 ** 48

/** 初始化竞争时的最大尝试次数（正常情况 1～2 次即可确定） */
const INIT_ATTEMPTS = 3

/** 只依赖本次用到的命令，便于测试替身实现 */
export interface GenerationStore {
  get: (key: string) => Promise<string | null>
  set: (key: string, value: string, options: { NX: true }) => Promise<string | null>
}

/** 生成不可复用的 generation 初始值（1 ~ 2^48-1） */
export function createGenerationSeed(): number {
  return randomInt(1, GENERATION_SEED_UPPER_BOUND)
}

/**
 * 读取全局 generation 的原始值；Key 不存在时用随机种子初始化。
 *
 * 全程使用 SET NX：绝不覆盖已存在的版本号，并发初始化也只有一个赢家。
 * 返回 null 表示多次竞争都没能确定版本号，调用方应绕过缓存。
 */
export async function readOrInitGeneration(
  client: GenerationStore,
  versionKey: string,
): Promise<string | null> {
  for (let attempt = 0; attempt < INIT_ATTEMPTS; attempt += 1) {
    const raw = await client.get(versionKey)

    if (raw !== null) return raw

    const seed = String(createGenerationSeed())
    const created = await client.set(versionKey, seed, { NX: true })

    if (created !== null) return seed
  }

  return null
}
