import { describe, expect, it } from 'vitest'

import { buildEmailCodeKeys, DEFAULT_EMAIL_CODE_KEY_PREFIX } from './email-code.keys.js'

describe('buildEmailCodeKeys', () => {
  const keys = buildEmailCodeKeys()
  const hash = 'f'.repeat(64)

  it('默认使用注册用途命名空间', () => {
    expect(DEFAULT_EMAIL_CODE_KEY_PREFIX).toBe('auth:email-code:register')
    expect(keys.code(hash)).toBe(`auth:email-code:register:${hash}`)
  })

  it('冷却与计数使用独立子命名空间，不会与验证码 Key 冲突', () => {
    expect(keys.cooldown(hash)).toBe(`auth:email-code:register:cooldown:${hash}`)
    expect(keys.hourly(hash)).toBe(`auth:email-code:register:hourly:${hash}`)
    expect(keys.ipHourly(hash)).toBe(`auth:email-code:register:ip-hourly:${hash}`)
  })

  it('支持自定义前缀并忽略末尾冒号', () => {
    const custom = buildEmailCodeKeys('test:prefix:')

    expect(custom.code(hash)).toBe(`test:prefix:${hash}`)
    expect(custom.ipHourly(hash)).toBe(`test:prefix:ip-hourly:${hash}`)
  })
})
