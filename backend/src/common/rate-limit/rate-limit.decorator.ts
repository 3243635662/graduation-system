import { SetMetadata } from '@nestjs/common'
import type { Request } from 'express'

export const RATE_LIMIT_METADATA_KEY = 'rate_limit'

/**
 * 限流配置
 */
export interface RateLimitOptions {
  /** 统计窗口（毫秒） */
  windowMs: number

  /** 窗口内允许的最大请求次数 */
  limit: number

  /** 超限时的提示信息 */
  message?: string

  /**
   * 限流维度，默认按客户端 IP 统计。
   *
   * 登录等接口可结合原始 body 中的 email 做「IP + 邮箱」联合限流。
   * 注意：此时 body 尚未经过 Zod 校验，读取时需做防御性处理。
   */
  keyBy?: (request: Request) => string
}

/**
 * 声明接口限流规则
 *
 * 需要与 RateLimitGuard 配合使用：
 *   @UseGuards(RateLimitGuard)
 *   @RateLimit({ windowMs: 60_000, limit: 10 })
 */
export function RateLimit(options: RateLimitOptions): MethodDecorator & ClassDecorator {
  return SetMetadata(RATE_LIMIT_METADATA_KEY, options)
}
