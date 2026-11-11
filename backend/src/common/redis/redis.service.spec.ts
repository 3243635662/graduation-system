import { ServiceUnavailableException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'

import type { RedisClient } from './redis.provider.js'
import { RedisService } from './redis.service.js'

interface FakeClientOptions {
  isReady?: boolean
  isOpen?: boolean
  pingResult?: string | Error
  quitError?: Error
}

function createFakeClient(options: FakeClientOptions = {}) {
  const state = {
    isReady: options.isReady ?? true,
    isOpen: options.isOpen ?? true,
  }

  const client = {
    get isReady() {
      return state.isReady
    },
    get isOpen() {
      return state.isOpen
    },
    ping: vi.fn(async () => {
      if (options.pingResult instanceof Error) throw options.pingResult

      return options.pingResult ?? 'PONG'
    }),
    quit: vi.fn(async () => {
      state.isOpen = false

      if (options.quitError) throw options.quitError

      return 'OK'
    }),
    destroy: vi.fn(() => {
      state.isOpen = false
    }),
    state,
  }

  return client
}

function createService(client: ReturnType<typeof createFakeClient>) {
  return new RedisService(client as unknown as RedisClient)
}

describe('RedisService', () => {
  it('连接就绪时返回客户端', () => {
    const client = createFakeClient()
    const service = createService(client)

    expect(service.isAvailable).toBe(true)
    expect(service.getClient()).toBe(client)
  })

  it('未就绪时抛 503，绝不返回不可用客户端', () => {
    const client = createFakeClient({ isReady: false })
    const service = createService(client)

    expect(service.isAvailable).toBe(false)
    expect(() => service.getClient()).toThrowError(ServiceUnavailableException)

    try {
      service.getClient()
    } catch (error) {
      expect((error as ServiceUnavailableException).getResponse()).toMatchObject({
        code: 50300,
      })
    }
  })

  it('PING 成功返回 true', async () => {
    const service = createService(createFakeClient())

    await expect(service.ping()).resolves.toBe(true)
  })

  it('PING 失败返回 false 而不抛错', async () => {
    const service = createService(createFakeClient({ pingResult: new Error('NOAUTH') }))

    await expect(service.ping()).resolves.toBe(false)
  })

  it('waitUntilReady 在超时后返回 false', async () => {
    const service = createService(createFakeClient({ isReady: false }))

    await expect(service.waitUntilReady(150, 50)).resolves.toBe(false)
  })

  it('waitUntilReady 在连接就绪后返回 true', async () => {
    const client = createFakeClient({ isReady: false })
    const service = createService(client)

    setTimeout(() => {
      client.state.isReady = true
    }, 50)

    await expect(service.waitUntilReady(1_000, 10)).resolves.toBe(true)
  })

  it('优雅关闭：调用 quit 释放连接', async () => {
    const client = createFakeClient()
    const service = createService(client)

    await service.onModuleDestroy()

    expect(client.quit).toHaveBeenCalledOnce()
  })

  it('quit 失败时用 destroy 兜底', async () => {
    const client = createFakeClient({ quitError: new Error('connection lost') })
    const service = createService(client)

    await service.onModuleDestroy()

    expect(client.destroy).toHaveBeenCalled()
  })

  it('连接已关闭时不重复关闭', async () => {
    const client = createFakeClient({ isOpen: false })
    const service = createService(client)

    await service.onModuleDestroy()

    expect(client.quit).not.toHaveBeenCalled()
  })
})
