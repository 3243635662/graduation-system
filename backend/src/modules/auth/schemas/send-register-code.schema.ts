import { z } from 'zod'

import { emailSchema } from './register.schema.js'

/**
 * 发送注册验证码的请求体
 *
 * strict()：只接受 email，拒绝 role / roleId / userId 等任何额外字段，
 * 防止客户端借验证码接口夹带身份信息。
 */
export const sendRegisterCodeSchema = z.object({ email: emailSchema }).strict()

export type SendRegisterCodeInput = z.infer<typeof sendRegisterCodeSchema>
