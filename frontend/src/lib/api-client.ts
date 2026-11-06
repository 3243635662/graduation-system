import { API_BASE_URL, API_TIMEOUT } from '@/constants/app-config'
import { toApiError, unwrapApiResponse } from '@/lib/api-response'
import type { ApiResponse } from '@/services/types/response.type'
/**
 * ofetch: https://github.com/unjs/ofetch
 */
import { ofetch } from 'ofetch'
import { toast } from 'vue-sonner'

/**
 * Clear the session and send the user back to sign-in when the API returns 401.
 * Imports are lazy to avoid a cycle (router -> pages -> services -> api-client).
 */
async function handleUnauthorized() {
  const [{ default: router }, { useAuthStore }, { default: pinia }] = await Promise.all([
    import('@/router'),
    import('@/stores/auth'),
    import('@/plugins/pinia/setup'),
  ])

  const authStore = useAuthStore(pinia)
  if (!authStore.isLogin) return

  authStore.isLogin = false
  toast.error('Your session has expired, please sign in again.')
  await router.push({ path: '/auth/sign-in' })
}

export const apiFetch = ofetch.create({
  baseURL: API_BASE_URL,
  timeout: API_TIMEOUT ?? 5000,

  onResponseError: async ({ response }) => {
    if (response.status === 401) await handleUnauthorized()
  },
})

/**
 * 对接后端统一响应的请求入口。
 *
 * 与 apiFetch 的区别：自动校验业务码、把 HTTP 错误体转成 ApiError，
 * 并直接返回 data。现有示例接口仍使用 apiFetch，可逐步迁移。
 */
export async function apiRequest<T>(
  path: string,
  options?: Parameters<typeof apiFetch<ApiResponse<T>>>[1],
): Promise<T> {
  try {
    const response = await apiFetch<ApiResponse<T>>(path, options)
    return unwrapApiResponse(response)
  } catch (error) {
    throw toApiError(error)
  }
}
