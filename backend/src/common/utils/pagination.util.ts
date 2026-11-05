import type { PaginatedData, PaginationQuery } from '@graduation/shared'

/**
 * Prisma 分页查询参数
 */
export interface PaginationArgs {
  /** 跳过的记录数量 */
  skip: number

  /** 本次查询的记录数量 */
  take: number
}

/**
 * 根据分页参数计算 Prisma 的 skip 和 take
 */
export function getPaginationArgs(query: PaginationQuery): PaginationArgs {
  const { page, pageSize } = query

  return {
    skip: (page - 1) * pageSize,
    take: pageSize,
  }
}

/**
 * 通用分页查询
 *
 * @param query 分页参数
 * @param findMany 查询当前页数据
 * @param count 查询符合条件的数据总数
 */
export async function paginate<T>(
  query: PaginationQuery,
  findMany: (args: PaginationArgs) => Promise<T[]>,
  count: () => Promise<number>,
): Promise<PaginatedData<T>> {
  const paginationArgs = getPaginationArgs(query)

  // 并行查询列表数据和总条数
  const [list, total] = await Promise.all([findMany(paginationArgs), count()])

  return {
    list,
    total,
  }
}
