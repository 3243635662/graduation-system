/**
 * 前后端统一 API 契约类型
 *
 * 运行时结构由后端的响应拦截器与全局异常过滤器生成：
 * - 成功：{ code: 0, data: T | null, message: '请求成功' }
 * - 失败：{ code: 非 0, data: null | 校验错误数组, message }
 *
 * 传输层可直接从本文件引入类型，不需要在各业务模块重复定义。
 */
export type { ApiResponse, PaginatedData, PaginationQuery } from '@graduation/shared'

/** 业务状态码：0 表示成功 */
export const API_SUCCESS_CODE = 0

/**
 * 后端业务错误码
 *
 * 与 GlobalExceptionFilter 的状态码映射、Zod 校验异常保持一致。
 */
export const API_ERROR_CODE = {
  BAD_REQUEST: 40000,
  VALIDATION_FAILED: 40001,
  UNAUTHORIZED: 40100,
  FORBIDDEN: 40300,
  NOT_FOUND: 40400,
  CONFLICT: 40900,
  UNPROCESSABLE_ENTITY: 42200,
  TOO_MANY_REQUESTS: 42900,
  INTERNAL_ERROR: 50000,
} as const

export type ApiErrorCode = (typeof API_ERROR_CODE)[keyof typeof API_ERROR_CODE]

/** Zod 参数校验失败的字段错误（后端 exceptionFactory 生成） */
export interface ApiValidationIssue {
  path: string
  message: string
}

/** 后端统一错误响应体（HTTP 4xx / 5xx 时返回） */
export interface ApiErrorResponse {
  code: number
  data: ApiValidationIssue[] | null
  message: string
}
