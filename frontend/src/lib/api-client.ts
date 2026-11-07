import { API_BASE_URL, API_TIMEOUT } from '@/constants/app-config'
import { getAccessToken, setAccessToken } from '@/lib/access-token'
import { ApiError, toApiError, unwrapApiResponse } from '@/lib/api-response'
import { emitSessionExpired, emitSessionRefreshed } from '@/lib/auth-events'
import { API_ERROR_CODE, type ApiResponse } from '@/services/types/response.type'
import type { AuthResult } from '@graduation/shared'
import { ofetch } from 'ofetch'

const REFRESH_PATH = '/auth/refresh'

/**
 * 基础请求客户端
 *
 * - withCredentials（credentials: 'include'）用于携带 HttpOnly Refresh Cookie
 * - 请求时自动附加 Authorization: Bearer <accessToken>
 */
export const apiFetch = ofetch.create({
  baseURL: API_BASE_URL,
  timeout: API_TIMEOUT ?? 5000,
  credentials: 'include',

  onRequest: ({ options }) => {
    const token = getAccessToken()

    if (!token) return

    const headers = new Headers(options.headers)
    headers.set('Authorization', `Bearer ${token}`)
    options.headers = headers
  },
})

type ApiRequestOptions = Parameters<typeof apiFetch<ApiResponse<unknown>>>[1]

function normalizePath(path: string): string {
  return path.replace(/^\/+/, '')
}

/** Refresh 接口自身绝不能触发再次刷新，否则会无限循环 */
function isRefreshRequest(path: string): boolean {
  return normalizePath(path) === normalizePath(REFRESH_PATH)
}

/** 只有 40101（Access Token 过期/失效）才尝试静默刷新 */
function isTokenExpired(error: Error): boolean {
  return error instanceof ApiError && error.code === API_ERROR_CODE.TOKEN_EXPIRED
}

/** 单飞刷新：并发 401 共用同一个刷新 Promise */
let refreshPromise: Promise<boolean> | null = null

const REFRESH_LOCK_NAME = 'graduation:auth-refresh'

interface LockManagerLike {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>
}

/**
 * 跨标签页刷新协调。
 *
 * 多个标签页共享同一个 Cookie 罐，但如果同时发出刷新请求，
 * 仍可能都读到「轮换前」的旧 Cookie。用 Web Locks 串行化后，
 * 后一个标签页会在前一个完成（Cookie 已更新）之后再请求。
 *
 * 不支持 Web Locks 的环境（测试、旧浏览器）直接执行，由后端宽限期兜底。
 */
function getLockManager(): LockManagerLike | null {
  if (typeof navigator === 'undefined') return null

  return (navigator as Navigator & { locks?: LockManagerLike }).locks ?? null
}

function withRefreshLock<T>(task: () => Promise<T>): Promise<T> {
  const locks = getLockManager()

  if (!locks) return task()

  return locks.request(REFRESH_LOCK_NAME, task)
}

/** 过期处理去重：避免并发 401 触发重复清理与重复跳转 */
let handlingExpiry = false

async function requestRefresh(): Promise<AuthResult> {
  const response = await apiFetch<ApiResponse<AuthResult>>(REFRESH_PATH, { method: 'POST' })

  return unwrapApiResponse(response)
}

/**
 * 刷新成功后先落地内存镜像，再通过事件通知 Store 同步 user。
 *
 * 先写镜像可以保证：即使 Store 尚未创建，重试请求也一定能拿到新 Token。
 */
function persistRefreshedSession(result: AuthResult): void {
  setAccessToken(result.accessToken)
  emitSessionRefreshed(result)
}

/**
 * 刷新失败：清空内存 Token 并通知组合根（清理状态、提示、跳转）。
 *
 * 去重标志会在订阅者的异步处理完成后才复位，避免并发 401 重复跳转。
 */
async function handleSessionExpired(): Promise<void> {
  if (handlingExpiry) return
  handlingExpiry = true

  try {
    setAccessToken(null)
    await emitSessionExpired()
  } finally {
    handlingExpiry = false
  }
}

async function performRefresh(): Promise<boolean> {
  try {
    const result = await requestRefresh()
    persistRefreshedSession(result)

    return true
  } catch {
    await handleSessionExpired()

    return false
  }
}

function ensureSessionRefreshed(): Promise<boolean> {
  refreshPromise ??= withRefreshLock(performRefresh).finally(() => {
    refreshPromise = null
  })

  return refreshPromise
}

async function sendRequest<T>(path: string, options: ApiRequestOptions): Promise<T> {
  const response = await apiFetch<ApiResponse<T>>(path, options)

  return unwrapApiResponse(response)
}

async function requestWithRetry<T>(
  path: string,
  options: ApiRequestOptions,
  retried: boolean,
): Promise<T> {
  try {
    return await sendRequest<T>(path, options)
  } catch (rawError) {
    const error = toApiError(rawError)

    if (!retried && isTokenExpired(error) && !isRefreshRequest(path)) {
      const refreshed = await ensureSessionRefreshed()

      if (refreshed) {
        return requestWithRetry<T>(path, options, true)
      }
    }

    throw error
  }
}

/**
 * 对接后端统一响应的请求入口。
 *
 * 与 apiFetch 的区别：自动校验业务码、把 HTTP 错误体转成 ApiError，
 * 并在 Access Token 过期时静默刷新后重试一次。
 */
export async function apiRequest<T>(path: string, options?: ApiRequestOptions): Promise<T> {
  return requestWithRetry<T>(path, options, false)
}
