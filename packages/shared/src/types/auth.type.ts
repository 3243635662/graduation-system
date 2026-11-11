/**
 * 用户状态，与 Prisma 的 UserStatus 枚举保持一致
 */
export const UserStatus = {
  ACTIVE: 'ACTIVE',
  DISABLED: 'DISABLED',
  LOCKED: 'LOCKED',
} as const

export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus]

/**
 * 角色摘要
 *
 * 认证响应中只返回必要字段，避免暴露权限、菜单等敏感信息。
 */
export interface RoleSummary {
  id: string
  code: string
  name: string
}

/**
 * 当前登录用户信息
 */
export interface AuthUser {
  id: string
  email: string
  displayName: string
  status: UserStatus
  roles: RoleSummary[]
}

/**
 * 认证结果
 *
 * 登录、注册、刷新接口统一返回该结构：
 * Refresh Token 只通过 HttpOnly Cookie 下发，不出现在 JSON 中。
 */
export interface AuthResult {
  accessToken: string
  user: AuthUser
}

/**
 * 注册输入（前后端共用的字段形状）
 *
 * emailCode 为邮箱验证码（6 位数字），必须先通过发送验证码接口获取。
 */
export interface RegisterInput {
  displayName: string
  email: string
  emailCode: string
  password: string
  confirmPassword: string
}

/**
 * 发送邮箱验证码的输入
 */
export interface SendEmailCodeInput {
  email: string
}

/**
 * 发送邮箱验证码的结果
 *
 * 出于防枚举考虑，即使邮箱已注册也返回同样结构：
 * 前端只能用 resendAfter 控制重新发送倒计时，无法据此判断邮箱是否已注册。
 */
export interface SendEmailCodeResult {
  /** 验证码有效期（秒） */
  expiresIn: number
  /** 允许重新发送的冷却时间（秒） */
  resendAfter: number
}

/**
 * 登录输入
 */
export interface LoginInput {
  email: string
  password: string
}
