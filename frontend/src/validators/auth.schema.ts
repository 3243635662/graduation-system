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

/**
 * 登录标识：邮箱 / 学号 / 工号三选一
 *
 * 三种标识的格式差异很大（邮箱含 @、学号与工号是编号），
 * 因此只做长度与必填校验，具体是否存在交给后端判断，避免误伤合法编号。
 */
const identifierSchema = z
  .string()
  .trim()
  .min(1, 'validation.identifierRequired')
  .max(191, 'validation.identifierMax')

/** 登录整表校验：只在提交时用，避免一失焦就把所有字段的错误都点亮 */
export const loginSchema = z.object({
  identifier: identifierSchema,
  password: loginPasswordSchema,
})

/** 登录表单的字段级规则（配合 `lazyValidate` 使用） */
export const loginFieldSchemas = {
  identifier: identifierSchema,
  password: loginPasswordSchema,
} as const

export type LoginFormValues = z.infer<typeof loginSchema>

/**
 * 真实姓名
 *
 * 毕设系统统一使用真名，不使用昵称或显示名：
 * 允许中文、英文字母、间隔号与空格，2-50 个字符（与后端 realNameSchema 对齐）。
 */
const realNameSchema = z
  .string()
  .trim()
  .min(2, 'validation.realNameMin')
  .max(50, 'validation.realNameMax')
  .regex(/^[\u4e00-\u9fa5A-Za-z·\s]+$/, 'validation.realNameFormat')

const emailCodeSchema = z.string().trim().regex(EMAIL_CODE_PATTERN, 'validation.emailCodeFormat')

const registerPasswordSchema = z
  .string()
  .min(8, 'validation.passwordMin')
  .max(128, 'validation.passwordMax')

const confirmPasswordSchema = z.string().min(1, 'validation.confirmPasswordRequired')

/** 注册整表校验：提交时统一校验，并处理「两次密码不一致」这类跨字段规则 */
export const registerSchema = z
  .object({
    realName: realNameSchema,
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
  realName: realNameSchema,
  email: emailSchema,
  emailCode: emailCodeSchema,
  password: registerPasswordSchema,
  confirmPassword: confirmPasswordSchema,
} as const

export type RegisterFormValues = z.infer<typeof registerSchema>

/** 密码修改/重置校验 */
export const resetPasswordSchema = z
  .object({
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

export const resetPasswordFieldSchemas = {
  email: emailSchema,
  emailCode: emailCodeSchema,
  password: registerPasswordSchema,
  confirmPassword: confirmPasswordSchema,
} as const

export type ResetPasswordFormValues = z.infer<typeof resetPasswordSchema>

/**
 * 个人资料表单校验
 *
 * 只校验「填了就合法」，全部留空是允许的（提交时会被过滤掉）。
 */
const optionalPhoneSchema = z
  .string()
  .trim()
  .refine((value) => value === '' || /^[\d+\-\s()]{6,20}$/.test(value), {
    message: 'validation.phoneFormat',
  })

const optionalAvatarSchema = z
  .string()
  .trim()
  .refine((value) => value === '' || /^https?:\/\/\S+$/i.test(value), {
    message: 'validation.avatarUrlFormat',
  })

export const profileSchema = z.object({
  realName: z.union([z.literal(''), realNameSchema]),
  phone: optionalPhoneSchema,
  avatarUrl: optionalAvatarSchema,
})

export const profileFieldSchemas = {
  realName: z.union([z.literal(''), realNameSchema]),
  phone: optionalPhoneSchema,
  avatarUrl: optionalAvatarSchema,
} as const

export type ProfileFormValues = z.infer<typeof profileSchema>

/** 邮箱换绑：当前密码只做必填/长度校验，正确性由后端判断 */
export const emailChangePasswordSchema = z
  .string()
  .min(1, 'validation.passwordRequired')
  .max(128, 'validation.passwordMax')

/** 邮箱换绑：新邮箱 + 验证码整表校验（提交时使用） */
export const bindEmailSchema = z.object({
  email: emailSchema,
  emailCode: emailCodeSchema,
})
