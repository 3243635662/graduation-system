import type { PaginationQuery } from '@graduation/shared'
import { z } from 'zod'

/**
 * 通用分页查询参数 Schema
 *
 * page：当前页码，默认 1
 * pageSize：每页数据量，默认 10，最大 100
 *
 * z.coerce.number() 会将 URL 查询参数中的字符串转换为数字。
 */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
}) satisfies z.ZodType<PaginationQuery>
