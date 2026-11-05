/**
 * 分页查询参数
 */
export interface PaginationQuery {
  /** 当前页码，从 1 开始 */
  page: number

  /** 每页数据量 */
  pageSize: number
}

/**
 * 分页数据结构
 */
export interface PaginatedData<T = unknown> {
  /** 当前页的数据列表 */
  list: T[]

  /** 符合查询条件的数据总数 */
  total: number
}
