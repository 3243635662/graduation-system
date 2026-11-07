import { describe, expect, it } from 'vitest'

import { extractBearerToken } from './bearer-token.util.js'

describe('extractBearerToken', () => {
  it('提取 Bearer Token（scheme 大小写不敏感）', () => {
    expect(extractBearerToken('Bearer abc.def')).toBe('abc.def')
    expect(extractBearerToken('bearer abc')).toBe('abc')
  })

  it('格式不合法时返回 null', () => {
    expect(extractBearerToken(undefined)).toBeNull()
    expect(extractBearerToken('Basic abc')).toBeNull()
    expect(extractBearerToken('Bearer')).toBeNull()
    expect(extractBearerToken('Bearer ')).toBeNull()
  })
})
