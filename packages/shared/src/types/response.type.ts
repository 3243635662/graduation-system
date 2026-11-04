/**
 * API 成功响应。
 *
 * 成功时 code 固定为 0，data 保存接口返回的业务数据。
 */
export interface ApiSuccessResponse<T> {
  code: 0
  message: string
  data: T
}

/**
 * 参数校验错误明细。
 *
 * path 使用点号表示嵌套字段，例如 profile.email。
 */
export interface ApiErrorDetail {
  path: string
  message: string
}

/**
 * API 失败响应。
 *
 * HTTP status 表达 HTTP 层面的状态，code 表达稳定的应用错误码。
 * 对于字段校验错误，可以通过 errors 返回具体字段及原因。
 */
export interface ApiErrorResponse {
  code: number
  message: string
  data: null
  errors?: ApiErrorDetail[]
}

/**
 * API 统一响应类型。
 *
 * 根据 code 是否为 0 区分成功与失败响应。
 */
export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse

/**
 * @deprecated 请优先使用 ApiResponse<T> 或 ApiSuccessResponse<T>。
 * 保留此别名用于迁移期兼容，后续可逐步替换旧名称。
 */
export type IResponse<T, _E = never> = ApiResponse<T>
