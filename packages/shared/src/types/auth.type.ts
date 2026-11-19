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
 * 只承载「这个用户在哪个组织范围内拥有哪个角色」，
 * 不返回数据范围策略，避免客户端据此自行判断授权。
 *
 * scopeOrgUnitId 为 null 表示该角色不绑定组织节点
 * （如 PLATFORM_SUPER_ADMIN / TEACHER / STUDENT）。
 */
export interface RoleSummary {
  id: string
  code: string
  name: string
  scopeOrgUnitId?: string | null
  scopeOrgUnitName?: string
  scopeOrgUnitType?: string
  validUntil?: string | null
}

/**
 * 当前登录用户信息
 *
 * 姓名统一使用真名 realName；头像统一取 avatarUrl。
 * permissions 只用于前端决定按钮/入口是否展示，
 * 真正的授权仍由后端在每次请求时实时校验。
 */
export interface AuthUser {
  id: string
  /** 换绑流程中解绑原邮箱后短暂为 null；重新绑定成功后恢复 */
  email: string | null
  phone: string | null
  realName: string
  avatarUrl: string | null
  status: UserStatus
  roles: RoleSummary[]
  permissions: string[]
  studentNo?: string | null
  className?: string | null
  teacherNo?: string | null
  title?: string | null
  organizationName?: string | null
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
  realName: string
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
 *
 * identifier 可以是邮箱、学号或工号。
 */
export interface LoginInput {
  identifier: string
  password: string
}

/**
 * 修改本人公共资料
 *
 * 学号、工号、班级与正式组织归属不允许通过该接口修改。
 */
export interface UpdateMyProfileInput {
  realName?: string
  phone?: string | null
  avatarUrl?: string | null
}

/**
 * 邮箱验证修改/重置密码输入
 */
export interface ResetPasswordInput {
  email: string
  emailCode: string
  password: string
  confirmPassword: string
}

/**
 * 邮箱换绑：验证当前密码
 *
 * 验证成功后返回短期有效的 changeToken，后续解绑、发码与绑定都必须携带该令牌。
 */
export interface VerifyEmailChangePasswordInput {
  password: string
}

export interface VerifyEmailChangePasswordResult {
  changeToken: string
  /** 令牌有效期（秒） */
  expiresIn: number
}

/** 邮箱换绑：解绑原邮箱 */
export interface UnbindEmailInput {
  changeToken: string
}

/** 邮箱换绑：向新邮箱发送验证码 */
export interface SendBindEmailCodeInput {
  email: string
  changeToken: string
}

/** 邮箱换绑：校验验证码并绑定新邮箱 */
export interface BindEmailInput {
  email: string
  emailCode: string
  changeToken: string
}
