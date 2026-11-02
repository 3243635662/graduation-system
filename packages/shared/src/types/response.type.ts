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

/** 分页查询基础参数 */
export interface IPaginationRequestQuery {
  page?: number
  pageSize?: number
}

/** 分页查询 + 业务筛选项 */
export type IRequestQuery<T extends Record<string, any>> = IPaginationRequestQuery & {
  [K in keyof T]?: T[K]
}

/** 分页响应体 */
export interface IPaginatedData<T> {
  list: T[]
  total: number
  page: number
  pageSize: number
}
