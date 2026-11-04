/**
 * 后端统一响应结构，前端 `apiFetch` 的返回值同样遵循该结构。
 */
export interface IResponse<T, E = Record<string, any>> {
  data: T
  extra: E
  code: number
  message: string
  success: boolean
}
