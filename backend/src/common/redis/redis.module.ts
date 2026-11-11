import { Global, Module } from '@nestjs/common'

import { REDIS_CLIENT } from './redis.constants.js'
import { redisClientProvider } from './redis.provider.js'
import { RedisService } from './redis.service.js'

/**
 * 全局 Redis 模块
 *
 * 与 PrismaModule 一致：全局只注册一次，业务模块直接注入 RedisService。
 */
@Global()
@Module({
  providers: [redisClientProvider, RedisService],
  exports: [REDIS_CLIENT, RedisService],
})
export class RedisModule {}
