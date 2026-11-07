import { describe, expect, it } from 'vitest'

import { loginSchema, registerSchema } from '../auth.schema'

describe('auth schemas', () => {
  describe('loginSchema', () => {
    it('接受合法邮箱与密码', () => {
      const result = loginSchema.safeParse({ email: 'Student@Example.com', password: '12345678' })

      expect(result.success).toBe(true)
      expect(result.success && result.data.email).toBe('student@example.com')
    })

    it('拒绝非法邮箱', () => {
      const result = loginSchema.safeParse({ email: 'not-an-email', password: '12345678' })
      expect(result.success).toBe(false)
    })

    it('密码不能为空', () => {
      const result = loginSchema.safeParse({ email: 'a@b.com', password: '' })
      expect(result.success).toBe(false)
    })
  })

  describe('registerSchema', () => {
    const base = {
      displayName: '张三',
      email: 'student@example.com',
      password: 'password123',
      confirmPassword: 'password123',
    }

    it('接受合法注册信息并规范化邮箱', () => {
      const result = registerSchema.safeParse({ ...base, email: '  Student@Example.com ' })

      expect(result.success).toBe(true)
      expect(result.success && result.data.email).toBe('student@example.com')
    })

    it('显示名称长度必须在 2～30 之间', () => {
      expect(registerSchema.safeParse({ ...base, displayName: 'a' }).success).toBe(false)
      expect(registerSchema.safeParse({ ...base, displayName: 'a'.repeat(31) }).success).toBe(false)
    })

    it('密码至少 8 位、最多 128 位', () => {
      expect(
        registerSchema.safeParse({ ...base, password: '1234567', confirmPassword: '1234567' })
          .success,
      ).toBe(false)
      expect(
        registerSchema.safeParse({
          ...base,
          password: 'a'.repeat(129),
          confirmPassword: 'a'.repeat(129),
        }).success,
      ).toBe(false)
    })

    it('两次密码不一致时在 confirmPassword 上给出错误', () => {
      const result = registerSchema.safeParse({ ...base, confirmPassword: 'different' })

      expect(result.success).toBe(false)

      if (!result.success) {
        expect(result.error.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ path: ['confirmPassword'], message: '两次输入的密码不一致' }),
          ]),
        )
      }
    })
  })
})
