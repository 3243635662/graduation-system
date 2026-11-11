import { apiRequest } from '@/lib/api-client'
import type {
  AuthResult,
  AuthUser,
  LoginInput,
  RegisterInput,
  SendEmailCodeResult,
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
