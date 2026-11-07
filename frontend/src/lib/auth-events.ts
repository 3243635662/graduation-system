import type { AuthResult } from '@graduation/shared'

type SessionRefreshedListener = (result: AuthResult) => void
type SessionExpiredListener = () => void | Promise<void>

/**
 * 认证事件桥（依赖倒置）
 *
 * `api-client` 位于依赖链底部，如果它直接 import `stores/auth` 或 `router`，
 * 就会形成 `api-client → store → auth.api → api-client` 的循环依赖。
 *
 * 这里把方向反过来：
 * - 请求层只负责 emit 事件；
 * - 组合根（store / router 入口）负责订阅，并在回调里更新状态、跳转。
 *
 * 本模块不依赖任何业务模块，处于依赖图的叶子位置。
 *
 * 单订阅者模型：应用中只有一个 Auth Store、一个 Router，因此用单槽位即可，
 * 重复注册视为替换，避免测试中反复创建 store 造成监听器泄漏。
 */
let sessionRefreshedListener: SessionRefreshedListener | null = null
let sessionExpiredListener: SessionExpiredListener | null = null

/** 注册「刷新成功」订阅者（由 Auth Store 在初始化时调用） */
export function onSessionRefreshed(listener: SessionRefreshedListener): void {
  sessionRefreshedListener = listener
}

/** 注册「会话过期」订阅者（由路由入口在组合根调用） */
export function onSessionExpired(listener: SessionExpiredListener): void {
  sessionExpiredListener = listener
}

/** 通知刷新成功，携带新的 Access Token 与用户信息 */
export function emitSessionRefreshed(result: AuthResult): void {
  sessionRefreshedListener?.(result)
}

/**
 * 通知会话过期。
 *
 * 返回订阅者可能产生的 Promise，让请求层可以等待「清理 + 跳转」完成后再复位去重标志，
 * 避免并发 401 在跳转未完成时再次触发处理。
 */
export function emitSessionExpired(): void | Promise<void> {
  return sessionExpiredListener?.()
}
