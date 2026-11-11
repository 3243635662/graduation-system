import { z } from 'zod'

/** 验证码固定六位数字，字符串形式以保留前导零 */
export const EMAIL_CODE_PATTERN = /^\d{6}$/

/**
 * 统一规范化邮箱：去除首尾空格、转小写、限制长度后做格式校验。
 *
 * 注意：先 trim/lowercase 再 pipe 到 z.email()，避免带空格的合法邮箱被误判。
 */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(191, '邮箱长度不能超过 191 个字符')
  .pipe(z.email('邮箱格式不正确'))

/**
 * 学生注册 Schema
 *
 * 密码不做 trim，避免改变用户实际密码。
 * confirmPassword 必须与 password 一致，由 superRefine 做跨字段校验。
 * emailCode 只做格式校验，真正的有效性校验必须在后端 Redis 中完成。
 */
export const registerSchema = z
  .object({
    displayName: z
      .string()
      .trim()
      .min(2, '显示名称至少 2 个字符')
      .max(30, '显示名称最多 30 个字符'),
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

export type RegisterInput = z.infer<typeof registerSchema>
