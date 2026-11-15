import { describe, expect, it } from 'vitest'

import { sanitizeAuditPayload } from './audit-payload.js'
import { AuditRecordError } from './audit.errors.js'

describe('sanitizeAuditPayload', () => {
  it('接受普通业务字段并返回深拷贝', () => {
    const source = { classId: 'class-1', meta: { from: 'class-0' }, tags: ['a', null] }
    const result = sanitizeAuditPayload(source, 'before')

    expect(result).toEqual(source)
    expect(result).not.toBe(source)
  })

  it.each([
    ['password'],
    ['passwordHash'],
    ['password_hash'],
    ['accessToken'],
    ['access_token'],
    ['refreshToken'],
    ['refresh_token_hash'],
    ['cookie'],
    ['authorization'],
    ['otp'],
    ['verificationCode'],
    ['verification_code'],
    ['idCardNo'],
    ['content'],
    ['fileContent'],
    ['file_content'],
    ['conversation'],
    ['prompt'],
  ])('拒绝敏感字段 %s', (key) => {
    expect(() => sanitizeAuditPayload({ [key]: 'secret-value' }, 'before')).toThrowError(
      AuditRecordError,
    )
  })

  it('拒绝嵌套对象中的敏感字段', () => {
    expect(() =>
      sanitizeAuditPayload({ profile: { access_token: 'token' } }, 'after'),
    ).toThrowError(/审计快照字段 after\.profile\.access_token/)
  })

  it('拒绝超过 500 字符的字符串，避免写入正文', () => {
    expect(() => sanitizeAuditPayload({ note: 'x'.repeat(501) }, 'before')).toThrowError(
      AuditRecordError,
    )
  })

  it('拒绝超过 3 层的嵌套', () => {
    expect(() => sanitizeAuditPayload({ a: { b: { c: { d: 1 } } } }, 'before')).toThrowError(
      /嵌套超过 3 层/,
    )
  })

  it('拒绝非 JSON 原始值', () => {
    expect(() => sanitizeAuditPayload({ at: new Date() }, 'before')).toThrowError(
      /只允许纯 JSON 对象/,
    )
    expect(() => sanitizeAuditPayload({ count: 1n }, 'before')).toThrowError(AuditRecordError)
    expect(() => sanitizeAuditPayload({ value: undefined }, 'before')).toThrowError(
      AuditRecordError,
    )
  })

  it('拒绝超长数组与超多字段的对象', () => {
    expect(() =>
      sanitizeAuditPayload({ ids: Array.from({ length: 51 }, (_, i) => i) }),
    ).toThrowError(AuditRecordError)

    const wide: Record<string, number> = {}

    for (let index = 0; index < 41; index += 1) wide[`k${index}`] = index

    expect(() => sanitizeAuditPayload(wide)).toThrowError(/字段数量超过 40 个/)
  })

  it('允许 null 值表达「不存在」', () => {
    expect(sanitizeAuditPayload({ fromClassId: null }, 'before')).toEqual({ fromClassId: null })
  })
})
