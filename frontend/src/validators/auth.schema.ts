import { z } from 'zod'

/**
 * 前端表单校验 Schema
 *
 * 前端校验只用于即时反馈；真正的安全边界在后端，后端会再次用 Zod 校验。
 * 邮箱统一 trim + 小写后再校验格式，与后端保持一致。
 */
const emailSchema = z.string().trim().toLowerCase().pipe(z.email('请输入正确的邮箱地址'))

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, '请输入密码'),
})

export type LoginFormValues = z.infer<typeof loginSchema>

export const registerSchema = z
  .object({
    displayName: z
      .string()
      .trim()
      .min(2, '显示名称至少 2 个字符')
      .max(30, '显示名称最多 30 个字符'),
    email: emailSchema,
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

export type RegisterFormValues = z.infer<typeof registerSchema>
