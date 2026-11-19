import { z } from 'zod'

import { EMAIL_CODE_PATTERN, emailSchema } from './register.schema.js'

export const sendResetPasswordCodeSchema = z.object({
  email: emailSchema,
})

export type SendResetPasswordCodeInput = z.infer<typeof sendResetPasswordCodeSchema>

export const resetPasswordSchema = z
  .object({
    email: emailSchema,
    emailCode: z.string().trim().regex(EMAIL_CODE_PATTERN, '邮箱验证码必须是 6 位数字'),
    password: z.string().min(8, '密码至少 8 位').max(128, '密码最多 128 位'),
    confirmPassword: z.string().min(1, '请再次输入密码'),
  })
  .superRefine((data, ctx) => {
    if (data.password !== data.confirmPassword) {
      ctx.addIssue({
        code: 'custom',
        path: ['confirmPassword'],
        message: '两次输入的密码不一致',
      })
    }
  })

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>
