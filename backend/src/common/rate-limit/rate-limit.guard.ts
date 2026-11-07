import {
  HttpException,
  HttpStatus,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Request } from 'express'

import { RATE_LIMIT_METADATA_KEY, type RateLimitOptions } from './rate-limit.decorator.js'

interface RateLimitBucket {
  count: number
  resetAt: number
}

/** 单实例内存限流，适用于单体部署，不适用于多实例分布式场景 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, RateLimitBucket>()
  private lastSweepAt = Date.now()

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(
      RATE_LIMIT_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    )

    if (!options) return true

    const request = context.switchToHttp().getRequest<Request>()
    const key = this.buildKey(request, options)

    this.sweep(4 * options.windowMs)

    const now = Date.now()
    const bucket = this.buckets.get(key)

    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + options.windowMs })
      return true
    }

    bucket.count += 1

    if (bucket.count > options.limit) {
      throw new HttpException(
        {
          code: 42900,
          data: null,
          message: options.message ?? '请求过于频繁，请稍后再试',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }

    return true
  }

  private buildKey(request: Request, options: RateLimitOptions): string {
    if (options.keyBy) return options.keyBy(request)

    return `ip:${request.ip ?? 'unknown'}`
  }

  /**
   * 按固定时间间隔清理过期桶，避免 Map 无限增长。
   */
  private sweep(intervalMs: number): void {
    const now = Date.now()

    if (now - this.lastSweepAt < intervalMs) return

    this.lastSweepAt = now

    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key)
      }
    }
  }
}
