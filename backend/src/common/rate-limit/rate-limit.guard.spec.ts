import { HttpException } from '@nestjs/common'
import type { ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { describe, expect, it } from 'vitest'

import { RATE_LIMIT_METADATA_KEY, type RateLimitOptions } from './rate-limit.decorator.js'
import { RateLimitGuard } from './rate-limit.guard.js'

function createContext(ip = '127.0.0.1'): ExecutionContext {
  const request = { ip, body: { email: 'a@b.com' } }

  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
  } as unknown as ExecutionContext
}

function createGuard(options?: RateLimitOptions): RateLimitGuard {
  const reflector = {
    getAllAndOverride: () => options,
  } as unknown as Reflector

  return new RateLimitGuard(reflector)
}

describe('RateLimitGuard', () => {
  it('没有限流元数据时直接放行', () => {
    const guard = createGuard(undefined)
    expect(guard.canActivate(createContext())).toBe(true)
  })

  it('未超过阈值时放行', () => {
    const guard = createGuard({ windowMs: 60_000, limit: 2 })
    const context = createContext()

    expect(guard.canActivate(context)).toBe(true)
    expect(guard.canActivate(context)).toBe(true)
  })

  it('超过阈值时抛出 429', () => {
    const guard = createGuard({ windowMs: 60_000, limit: 1 })
    const context = createContext()

    guard.canActivate(context)

    expect(() => guard.canActivate(context)).toThrowError(HttpException)
  })

  it('不同限流维度互不影响', () => {
    const guard = createGuard({ windowMs: 60_000, limit: 1 })

    expect(guard.canActivate(createContext('1.1.1.1'))).toBe(true)
    expect(guard.canActivate(createContext('2.2.2.2'))).toBe(true)
  })

  it('支持自定义 keyBy', () => {
    const guard = createGuard({
      windowMs: 60_000,
      limit: 1,
      keyBy: (request) => `custom:${(request.body as { email: string }).email}`,
    })

    expect(guard.canActivate(createContext('1.1.1.1'))).toBe(true)
    expect(() => guard.canActivate(createContext('2.2.2.2'))).toThrowError(HttpException)
  })

  it('元数据 key 与装饰器保持一致', () => {
    expect(RATE_LIMIT_METADATA_KEY).toBe('rate_limit')
  })
})
