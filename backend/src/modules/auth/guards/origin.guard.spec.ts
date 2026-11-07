import { ForbiddenException, type ExecutionContext } from '@nestjs/common'
import { beforeEach, describe, expect, it } from 'vitest'

import { OriginGuard } from './origin.guard.js'

function createContext(origin?: string): ExecutionContext {
  const request = { headers: origin ? { origin } : {} }

  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext
}

describe('OriginGuard', () => {
  beforeEach(() => {
    process.env['CORS_ORIGIN'] = 'http://localhost:5173,https://app.example.com'
  })

  it('放行白名单来源', () => {
    const guard = new OriginGuard()

    expect(guard.canActivate(createContext('http://localhost:5173'))).toBe(true)
    expect(guard.canActivate(createContext('https://app.example.com'))).toBe(true)
  })

  it('拒绝非白名单来源', () => {
    const guard = new OriginGuard()

    expect(() => guard.canActivate(createContext('http://evil.test'))).toThrowError(
      ForbiddenException,
    )
  })

  it('无 Origin 时放行非浏览器客户端', () => {
    const guard = new OriginGuard()

    expect(guard.canActivate(createContext())).toBe(true)
  })
})
