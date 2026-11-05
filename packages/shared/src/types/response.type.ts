/**
 * API 统一响应结构
 */
export interface ApiResponse<T = unknown> {
  /** 业务状态码：0 表示成功，非 0 表示业务错误 */
  code: number

  /** 响应数据 */
  data: T | null

  /** 响应消息 */
  message: string
}
