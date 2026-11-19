import { apiRequest } from '@/lib/api-client'
import type {
  AuthResult,
  AuthUser,
  BindEmailInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
  SendBindEmailCodeInput,
  SendEmailCodeResult,
  UnbindEmailInput,
  VerifyEmailChangePasswordInput,
  VerifyEmailChangePasswordResult,
} from '@graduation/shared'

/**
 * Auth 接口封装
 *
 * 统一走 apiRequest：自动附带 Cookie、注入 Access Token、
 * 遇到 40101（Access Token 过期）时静默刷新并重试一次。
 * Refresh Token 通过 HttpOnly Cookie 下发，不会出现在 JSON 响应中。
 */

export function register(input: RegisterInput): Promise<AuthResult> {
  return apiRequest<AuthResult>('/auth/register', {
    method: 'POST',
    body: input,
  })
}

/**
 * 发送注册邮箱验证码
 *
 * 返回的 resendAfter 用于前端倒计时展示；真正的发送频率由服务端 Redis 强制限制。
 */
export function sendRegisterCode(email: string): Promise<SendEmailCodeResult> {
  return apiRequest<SendEmailCodeResult>('/auth/email-codes/register', {
    method: 'POST',
    body: { email },
  })
}

/**
 * 发送修改/重置密码邮箱验证码
 */
export function sendResetPasswordCode(email: string): Promise<SendEmailCodeResult> {
  return apiRequest<SendEmailCodeResult>('/auth/email-codes/reset-password', {
    method: 'POST',
    body: { email },
  })
}

/**
 * 邮箱验证码修改/重置密码
 */
export function resetPassword(input: ResetPasswordInput): Promise<{ message: string }> {
  return apiRequest<{ message: string }>('/auth/reset-password', {
    method: 'POST',
    body: input,
  })
}

/** 换绑第一步：验证当前密码，换取短期令牌 */
export function verifyEmailChangePassword(
  password: string,
): Promise<VerifyEmailChangePasswordResult> {
  const input: VerifyEmailChangePasswordInput = { password }

  return apiRequest<VerifyEmailChangePasswordResult>('/auth/email-change/verify-password', {
    method: 'POST',
    body: input,
  })
}

/** 换绑第二步：解绑原邮箱 */
export function unbindEmail(input: UnbindEmailInput): Promise<{ email: null }> {
  return apiRequest<{ email: null }>('/auth/email-change/unbind', {
    method: 'POST',
    body: input,
  })
}

/** 换绑第三步：向新邮箱发送验证码 */
export function sendBindEmailCode(input: SendBindEmailCodeInput): Promise<SendEmailCodeResult> {
  return apiRequest<SendEmailCodeResult>('/auth/email-codes/bind-email', {
    method: 'POST',
    body: input,
  })
}

/** 换绑第四步：校验验证码并绑定新邮箱 */
export function bindEmail(input: BindEmailInput): Promise<AuthUser> {
  return apiRequest<AuthUser>('/auth/email-change/bind', {
    method: 'POST',
    body: input,
  })
}

export function login(input: LoginInput): Promise<AuthResult> {
  return apiRequest<AuthResult>('/auth/login', {
    method: 'POST',
    body: input,
  })
}

export function refresh(): Promise<AuthResult> {
  return apiRequest<AuthResult>('/auth/refresh', {
    method: 'POST',
  })
}

export function getMe(): Promise<AuthUser> {
  return apiRequest<AuthUser>('/auth/me', {
    method: 'GET',
  })
}

export function logout(): Promise<boolean> {
  return apiRequest<boolean>('/auth/logout', {
    method: 'POST',
  })
}
