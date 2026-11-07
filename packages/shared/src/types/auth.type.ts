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
 */
export interface RegisterInput {
  displayName: string
  email: string
  password: string
  confirmPassword: string
}

/**
 * 登录输入
 */
export interface LoginInput {
  email: string
  password: string
}
