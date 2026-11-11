import { describe, expect, it } from 'vitest'

import {
  generateSixDigitCode,
  hashIdentifier,
  hashRegisterCode,
  normalizeEmail,
  toSixDigitCode,
} from './email-code.crypto.js'

const PEPPER = 'unit-test-pepper-0123456789'

describe('验证码生成', () => {
  it('始终是 6 位数字字符串', () => {
    for (let index = 0; index < 300; index += 1) {
      const code = generateSixDigitCode()

      expect(typeof code).toBe('string')
      expect(code).toMatch(/^\d{6}$/)
    }
  })

  it('保留前导零', () => {
    expect(toSixDigitCode(0)).toBe('000000')
    expect(toSixDigitCode(42)).toBe('000042')
    expect(toSixDigitCode(123_456)).toBe('123456')
  })
})

describe('邮箱规范化', () => {
  it('trim 并转小写', () => {
    expect(normalizeEmail('  Student@Example.COM ')).toBe('student@example.com')
  })
})

describe('HMAC 摘要', () => {
  it('同一输入产生稳定摘要', () => {
    expect(hashRegisterCode(PEPPER, 'a@b.com', '123456')).toBe(
      hashRegisterCode(PEPPER, 'a@b.com', '123456'),
    )
  })

  it('摘要长度为 64 位十六进制（SHA-256）', () => {
    expect(hashRegisterCode(PEPPER, 'a@b.com', '123456')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('不同 Pepper 产生不同摘要', () => {
    expect(hashRegisterCode(PEPPER, 'a@b.com', '123456')).not.toBe(
      hashRegisterCode('another-pepper-0123456789', 'a@b.com', '123456'),
    )
  })

  it('邮箱大小写与空格不影响摘要', () => {
    expect(hashRegisterCode(PEPPER, '  A@B.com ', '123456')).toBe(
      hashRegisterCode(PEPPER, 'a@b.com', '123456'),
    )
  })

  it('邮箱隔离：同一验证码在不同邮箱下摘要不同', () => {
    expect(hashRegisterCode(PEPPER, 'a@b.com', '123456')).not.toBe(
      hashRegisterCode(PEPPER, 'other@b.com', '123456'),
    )
  })

  it('业务用途隔离：注册与找回密码不共用摘要', () => {
    // 模拟另一业务用途的前缀
    const otherScope = hashIdentifier(PEPPER, 'email', 'register-code:a@b.com:123456')

    expect(hashRegisterCode(PEPPER, 'a@b.com', '123456')).not.toBe(otherScope)
  })

  it('邮箱与 IP 标识哈希互不相同', () => {
    expect(hashIdentifier(PEPPER, 'email', 'a@b.com')).not.toBe(
      hashIdentifier(PEPPER, 'ip', 'a@b.com'),
    )
  })

  it('摘要中不含原始邮箱（长度固定）', () => {
    const digest = hashIdentifier(PEPPER, 'email', 'very-long-address@example.com')

    expect(digest).toMatch(/^[0-9a-f]{64}$/)
    expect(digest).not.toContain('example')
  })
})
