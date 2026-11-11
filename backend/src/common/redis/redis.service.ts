import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  type OnModuleDestroy,
} from '@nestjs/common'

import { REDIS_CLIENT } from './redis.constants.js'
import type { RedisClient } from './redis.provider.js'

/** Redis 不可用的统一业务错误（503） */
export function createRedisUnavailableError(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code: 50300,
    data: null,
    message: '验证码服务暂时不可用，请稍后重试',
  })
}

const QUIT_TIMEOUT_MS = 1_000

/**
 * Redis 访问入口
 *
 * 设计原则：Redis 不可用时「失败关闭」——
 * 直接抛出 503，绝不降级为内存存储，也绝不放行本该校验的验证码。
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name)

  constructor(@Inject(REDIS_CLIENT) private readonly client: RedisClient) {}

  /** 是否已建立可用连接 */
  get isAvailable(): boolean {
    return this.client.isReady
  }

  /**
   * 获取已就绪的客户端。
   *
   * 未就绪时立刻抛 503，不让请求在离线队列里悬挂。
   */
  getClient(): RedisClient {
    if (!this.client.isReady) {
      throw createRedisUnavailableError()
    }

    return this.client
  }

  /**
   * 等待连接就绪。
   *
   * 连接是异步建立的，启动自检与集成测试需要一个可等待的入口。
   */
  async waitUntilReady(timeoutMs = 5_000, intervalMs = 100): Promise<boolean> {
    const deadline = Date.now() + timeoutMs

    while (Date.now() < deadline) {
      if (this.client.isReady) return true

      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }

    return this.client.isReady
  }

  /** 健康探测，失败返回 false 而不抛错 */
  async ping(): Promise<boolean> {
    try {
      return (await this.client.ping()) === 'PONG'
    } catch (error) {
      this.logger.warn(`Redis PING 失败：${error instanceof Error ? error.message : String(error)}`)

      return false
    }
  }

  /** 应用关闭时优雅释放连接：先 quit 排空在途命令，超时后强制 destroy */
  async onModuleDestroy(): Promise<void> {
    if (!this.client.isOpen) return

    let timer: NodeJS.Timeout | undefined

    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, QUIT_TIMEOUT_MS)
      timer.unref()
    })

    try {
      await Promise.race([this.client.quit().then(() => undefined), timeout])
    } catch (error) {
      this.logger.warn(
        `Redis 关闭时出错：${error instanceof Error ? error.message : String(error)}`,
      )
    } finally {
      if (timer) clearTimeout(timer)

      try {
        this.client.destroy()
      } catch {
        // 已关闭时 destroy 可能抛错，忽略
      }
    }
  }
}
