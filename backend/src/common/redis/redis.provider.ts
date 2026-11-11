import { Logger, type Provider } from '@nestjs/common'
import { createClient, type RedisClientType } from 'redis'

import { loadRedisConfig } from './redis.config.js'
import { REDIS_CLIENT } from './redis.constants.js'

export type RedisClient = RedisClientType

/**
 * 重连策略：指数退避，最大 3 秒，永不放弃。
 *
 * Redis 是外部依赖，短暂重启不应导致应用永久失去缓存能力。
 */
function reconnectDelay(retries: number): number {
  return Math.min(200 + retries * 300, 3_000)
}

/**
 * 单例 Redis 客户端
 *
 * 重要取舍：
 * - `disableOfflineQueue: true`：未连接时命令立即失败，而不是排队等待，
 *   这样业务层能立刻按「服务不可用」失败关闭，不会挂住请求。
 * - 不 `await client.connect()`：node-redis 在重连策略下会持续重试，
 *   await 会阻塞应用启动。连接成功/失败通过事件日志体现。
 */
export const redisClientProvider: Provider = {
  provide: REDIS_CLIENT,
  useFactory: (): RedisClient => {
    const logger = new Logger('Redis')
    // 配置错误属于部署问题，启动即失败，避免带病运行
    const config = loadRedisConfig()

    const client = createClient({
      socket: {
        host: config.host,
        port: config.port,
        connectTimeout: config.connectTimeoutMs,
        reconnectStrategy: reconnectDelay,
      },
      username: config.username,
      password: config.password,
      database: config.database,
      disableOfflineQueue: true,
    })

    client.on('error', (error: Error) => {
      // 只记录错误信息，绝不输出密码
      logger.error(`Redis 错误：${error.message}`)
    })

    client.on('ready', () => {
      logger.log(`Redis 已连接 ${config.host}:${config.port} db=${config.database}`)
    })

    client.on('end', () => {
      logger.warn('Redis 连接已关闭')
    })

    void client.connect().catch((error: unknown) => {
      logger.error(`Redis 初始连接失败：${error instanceof Error ? error.message : String(error)}`)
    })

    return client
  },
}
