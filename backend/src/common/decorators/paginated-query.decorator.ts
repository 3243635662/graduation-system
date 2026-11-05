import { Query } from '@nestjs/common'
import type { ZodType } from 'zod'

import { paginationSchema } from '../schemas/pagination.schema.js'

/**
 * 分页查询参数装饰器
 *
 * 默认使用公共分页 Schema。
 * 也可以传入扩展后的业务查询 Schema。
 */
export function PaginatedQuery(schema: ZodType = paginationSchema): ParameterDecorator {
  return Query({ schema })
}
