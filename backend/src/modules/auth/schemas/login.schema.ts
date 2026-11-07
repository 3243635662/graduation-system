import { z } from 'zod'

import { emailSchema } from './register.schema.js'

/**
 * 登录 Schema
 *
 * 只校验输入格式，不暴露「邮箱是否存在」等业务信息。
 */
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, '请输入密码'),
})

export type LoginInput = z.infer<typeof loginSchema>
