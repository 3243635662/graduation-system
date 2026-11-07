import { z } from 'zod'

/**
 * 统一规范化邮箱：去除首尾空格并转小写后再做格式校验。
 *
 * 注意：先 trim/lowercase 再 pipe 到 z.email()，避免带空格的合法邮箱被误判。
 */
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email('邮箱格式不正确'))

/**
 * 学生注册 Schema
 *
 * 密码不做 trim，避免改变用户实际密码。
 * confirmPassword 必须与 password 一致，由 superRefine 做跨字段校验。
 */
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

export type RegisterInput = z.infer<typeof registerSchema>
