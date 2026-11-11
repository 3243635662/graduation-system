import { z } from 'zod'

/**
 * 前端表单校验 Schema
 *
 * 前端校验只用于即时反馈；真正的安全边界在后端，后端会再次用 Zod 校验。
 * 邮箱统一 trim + 小写后再校验格式，与后端保持一致。
 *
 * 校验失败的 message 统一存 i18n key（`validation.*`），由展示层翻译，
 * 这样切换语言时已显示的报错也会跟着切换。
 */
const emailSchema = z.string().trim().toLowerCase().pipe(z.email('validation.email'))

/** 邮箱验证码固定六位数字 */
export const EMAIL_CODE_PATTERN = /^\d{6}$/

/**
 * 发送邮箱验证码的请求校验
 *
 * 邮箱无效时禁止点击发送，减少无意义的服务端请求。
 */
export const sendEmailCodeSchema = z.object({ email: emailSchema })

const loginPasswordSchema = z.string().min(1, 'validation.passwordRequired')

/** 登录整表校验：只在提交时用，避免一失焦就把所有字段的错误都点亮 */
export const loginSchema = z.object({
  email: emailSchema,
  password: loginPasswordSchema,
})

/** 登录表单的字段级规则（配合 `lazyValidate` 使用） */
export const loginFieldSchemas = {
  email: emailSchema,
  password: loginPasswordSchema,
} as const

export type LoginFormValues = z.infer<typeof loginSchema>

const displayNameSchema = z
  .string()
  .trim()
  .min(2, 'validation.displayNameMin')
  .max(30, 'validation.displayNameMax')

const emailCodeSchema = z.string().trim().regex(EMAIL_CODE_PATTERN, 'validation.emailCodeFormat')

const registerPasswordSchema = z
  .string()
  .min(8, 'validation.passwordMin')
  .max(128, 'validation.passwordMax')

const confirmPasswordSchema = z.string().min(1, 'validation.confirmPasswordRequired')

/** 注册整表校验：提交时统一校验，并处理「两次密码不一致」这类跨字段规则 */
export const registerSchema = z
  .object({
    displayName: displayNameSchema,
    email: emailSchema,
    emailCode: emailCodeSchema,
    password: registerPasswordSchema,
    confirmPassword: confirmPasswordSchema,
  })
  .superRefine((data, ctx) => {
    if (data.password !== data.confirmPassword) {
      ctx.addIssue({
        code: 'custom',
        path: ['confirmPassword'],
        message: 'validation.passwordMismatch',
      })
    }
  })

/** 注册表单的字段级规则（配合 `lazyValidate` 使用） */
export const registerFieldSchemas = {
  displayName: displayNameSchema,
  email: emailSchema,
  emailCode: emailCodeSchema,
  password: registerPasswordSchema,
  confirmPassword: confirmPasswordSchema,
} as const

export type RegisterFormValues = z.infer<typeof registerSchema>
