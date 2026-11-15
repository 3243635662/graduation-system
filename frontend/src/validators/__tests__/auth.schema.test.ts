import { describe, expect, it } from 'vitest'

import { loginSchema, profileSchema, registerSchema, sendEmailCodeSchema } from '../auth.schema'

describe('auth schemas', () => {
  describe('loginSchema', () => {
    it('接受邮箱标识并 trim', () => {
      const result = loginSchema.safeParse({
        identifier: '  Student@Example.com ',
        password: '12345678',
      })

      expect(result.success).toBe(true)
      expect(result.success && result.data.identifier).toBe('Student@Example.com')
    })

    it('接受学号或工号作为标识', () => {
      expect(loginSchema.safeParse({ identifier: '2021001001', password: 'x' }).success).toBe(true)
      expect(loginSchema.safeParse({ identifier: 'T-0012', password: 'x' }).success).toBe(true)
    })

    it('标识不能为空', () => {
      const result = loginSchema.safeParse({ identifier: '   ', password: '12345678' })

      expect(result.success).toBe(false)

      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe('validation.identifierRequired')
      }
    })

    it('密码不能为空', () => {
      expect(loginSchema.safeParse({ identifier: 'a@b.com', password: '' }).success).toBe(false)
    })
  })

  describe('sendEmailCodeSchema', () => {
    it('接受合法邮箱并规范化', () => {
      const result = sendEmailCodeSchema.safeParse({ email: ' Student@Example.com ' })

      expect(result.success).toBe(true)
      expect(result.success && result.data.email).toBe('student@example.com')
    })

    it('拒绝非法邮箱', () => {
      expect(sendEmailCodeSchema.safeParse({ email: '' }).success).toBe(false)
      expect(sendEmailCodeSchema.safeParse({ email: 'not-an-email' }).success).toBe(false)
    })
  })

  describe('registerSchema', () => {
    const base = {
      realName: '张三',
      email: 'student@example.com',
      emailCode: '123456',
      password: 'password123',
      confirmPassword: 'password123',
    }

    it('接受合法注册信息并规范化邮箱', () => {
      const result = registerSchema.safeParse({ ...base, email: '  Student@Example.com ' })

      expect(result.success).toBe(true)
      expect(result.success && result.data.email).toBe('student@example.com')
    })

    it('缺少验证码时校验失败', () => {
      const withoutCode = {
        realName: base.realName,
        email: base.email,
        password: base.password,
        confirmPassword: base.confirmPassword,
      }

      expect(registerSchema.safeParse(withoutCode).success).toBe(false)
    })

    it('验证码必须是 6 位数字', () => {
      expect(registerSchema.safeParse({ ...base, emailCode: '12345' }).success).toBe(false)
      expect(registerSchema.safeParse({ ...base, emailCode: '1234567' }).success).toBe(false)
      expect(registerSchema.safeParse({ ...base, emailCode: '12ab56' }).success).toBe(false)
      expect(registerSchema.safeParse({ ...base, emailCode: '' }).success).toBe(false)
    })

    it('验证码允许前后空格（trim 后校验）', () => {
      const result = registerSchema.safeParse({ ...base, emailCode: ' 123456 ' })

      expect(result.success).toBe(true)
      expect(result.success && result.data.emailCode).toBe('123456')
    })

    it('密码不做 trim，保留原值', () => {
      const result = registerSchema.safeParse({
        ...base,
        password: ' password123 ',
        confirmPassword: ' password123 ',
      })

      expect(result.success).toBe(true)
      expect(result.success && result.data.password).toBe(' password123 ')
    })

    it('真实姓名长度必须在 2～50 之间', () => {
      expect(registerSchema.safeParse({ ...base, realName: 'a' }).success).toBe(false)
      expect(registerSchema.safeParse({ ...base, realName: 'a'.repeat(51) }).success).toBe(false)
    })

    it('真实姓名只允许中文、英文字母、间隔号与空格', () => {
      expect(registerSchema.safeParse({ ...base, realName: '张三123' }).success).toBe(false)
      expect(registerSchema.safeParse({ ...base, realName: '阿依古丽·买买提' }).success).toBe(true)
      expect(registerSchema.safeParse({ ...base, realName: 'John Smith' }).success).toBe(true)
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
            expect.objectContaining({
              path: ['confirmPassword'],
              message: 'validation.passwordMismatch',
            }),
          ]),
        )
      }
    })
  })

  describe('profileSchema', () => {
    it('允许全部留空（表示不修改/清空）', () => {
      expect(profileSchema.safeParse({ realName: '', phone: '', avatarUrl: '' }).success).toBe(true)
    })

    it('校验手机号与头像地址格式', () => {
      expect(
        profileSchema.safeParse({ realName: '张三', phone: 'abc', avatarUrl: '' }).success,
      ).toBe(false)
      expect(
        profileSchema.safeParse({ realName: '张三', phone: '', avatarUrl: 'ftp://a.png' }).success,
      ).toBe(false)
      expect(
        profileSchema.safeParse({
          realName: '张三',
          phone: '13800000000',
          avatarUrl: 'https://cdn.example.com/a.png',
        }).success,
      ).toBe(true)
    })
  })
})
