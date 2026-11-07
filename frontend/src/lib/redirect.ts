/** 认证页面本身不能作为登录后的跳转目标，避免登录后又回到登录页 */
const AUTH_PAGES = new Set(['/auth/sign-in', '/auth/sign-up'])

/**
 * 解析并校验登录后的跳转地址
 *
 * 只接受站内绝对路径，拒绝协议相对地址（//evil.com）与认证页自身。
 */
export function resolveSafeRedirect(value: unknown, fallback = '/dashboard'): string {
  if (typeof value !== 'string') return fallback
  if (!value.startsWith('/') || value.startsWith('//')) return fallback
  if (AUTH_PAGES.has(value)) return fallback

  return value
}
