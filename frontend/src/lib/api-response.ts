import {
  API_SUCCESS_CODE,
  type ApiResponse,
  type ApiValidationIssue,
} from '@/services/types/response.type'

/**
 * 统一 API 错误
 *
 * 业务码非 0，或 HTTP 异常携带后端错误体时抛出，
 * 让业务层只需处理一种错误对象。
 */
export class ApiError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly issues: ApiValidationIssue[] = [],
    readonly status?: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

function isApiErrorBody(value: unknown): value is {
  code: number
  data: unknown
  message: string
} {
  if (typeof value !== 'object' || value === null) return false

  const body = value as Record<string, unknown>
  return typeof body.code === 'number' && typeof body.message === 'string'
}

/**
 * 校验业务码并解包 data。
 *
 * 成功响应的 data 可能为 null（后端 `result ?? null`），此处视为异常，
 * 避免组件里到处出现 `data.data ?? 默认值`。
 */
export function unwrapApiResponse<T>(response: ApiResponse<T>): T {
  if (response.code !== API_SUCCESS_CODE) {
    const issues = Array.isArray(response.data) ? (response.data as ApiValidationIssue[]) : []

    throw new ApiError(response.code, response.message, issues)
  }

  if (response.data === null) {
    throw new ApiError(response.code, '响应数据为空')
  }

  return response.data
}

/**
 * 将 ofetch 的 HTTP 异常转换为 ApiError；非后端格式的错误保持原样。
 */
export function toApiError(error: unknown): Error {
  if (error instanceof ApiError) return error

  if (typeof error === 'object' && error !== null) {
    const fetchError = error as {
      status?: number
      data?: unknown
      response?: { status?: number } & Record<string, unknown>
    }
    const body = fetchError.data ?? fetchError.response?.['_data']

    if (isApiErrorBody(body)) {
      const issues = Array.isArray(body.data) ? (body.data as ApiValidationIssue[]) : []

      return new ApiError(
        body.code,
        body.message,
        issues,
        fetchError.status ?? fetchError.response?.status,
      )
    }
  }

  return error instanceof Error ? error : new Error(String(error))
}
