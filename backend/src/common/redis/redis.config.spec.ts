import { describe, expect, it } from 'vitest'

import { loadRedisConfig } from './redis.config.js'

describe('loadRedisConfig', () => {
  it('读取完整的 Redis 连接配置', () => {
    const config = loadRedisConfig({
      REDIS_HOST: '127.0.0.1',
      REDIS_PORT: '6380',
      REDIS_USERNAME: 'default',
      REDIS_PASSWORD: 'secret',
      REDIS_DB: '0',
    })

    expect(config).toMatchObject({
      host: '127.0.0.1',
      port: 6380,
      username: 'default',
      password: 'secret',
      database: 0,
    })
  })

  it('缺省值：本地 6379、db 0、无密码', () => {
    const config = loadRedisConfig({})

    expect(config.host).toBe('127.0.0.1')
    expect(config.port).toBe(6379)
    expect(config.database).toBe(0)
    expect(config.password).toBeUndefined()
    expect(config.username).toBeUndefined()
  })

  it('端口非法时抛错', () => {
    expect(() => loadRedisConfig({ REDIS_PORT: '0' })).toThrowError(/REDIS_PORT/)
    expect(() => loadRedisConfig({ REDIS_PORT: '65536' })).toThrowError(/REDIS_PORT/)
    expect(() => loadRedisConfig({ REDIS_PORT: 'abc' })).toThrowError(/REDIS_PORT/)
  })

  it('数据库索引非法时抛错', () => {
    expect(() => loadRedisConfig({ REDIS_DB: '16' })).toThrowError(/REDIS_DB/)
  })

  it('主机为空时抛错', () => {
    expect(() => loadRedisConfig({ REDIS_HOST: '   ' })).toThrowError(/REDIS_HOST/)
  })
})
