import { z } from 'zod'

import { EMAIL_CODE_PATTERN, emailSchema } from './register.schema.js'

/** 换绑令牌：服务端随机生成的 32 字节十六进制字符串 */
const changeTokenSchema = z
  .string()
  .trim()
  .regex(/^[a-f0-9]{64}$/, '身份验证令牌格式不正确')

/** 第一步：验证当前密码 */
export const verifyEmailChangePasswordSchema = z.object({
  password: z.string().min(1, '请输入当前密码').max(128, '密码最多 128 位'),
})

/** 第二步：解绑原邮箱 */
export const unbindEmailSchema = z.object({
  changeToken: changeTokenSchema,
})

/** 第三步：向新邮箱发送验证码 */
export const sendBindEmailCodeSchema = z.object({
  email: emailSchema,
  changeToken: changeTokenSchema,
})

/** 第四步：校验验证码并绑定新邮箱 */
export const bindEmailSchema = z.object({
  email: emailSchema,
  emailCode: z.string().trim().regex(EMAIL_CODE_PATTERN, '邮箱验证码必须是 6 位数字'),
  changeToken: changeTokenSchema,
})

export type VerifyEmailChangePasswordInput = z.infer<typeof verifyEmailChangePasswordSchema>
export type UnbindEmailInput = z.infer<typeof unbindEmailSchema>
export type SendBindEmailCodeInput = z.infer<typeof sendBindEmailCodeSchema>
export type BindEmailInput = z.infer<typeof bindEmailSchema>
