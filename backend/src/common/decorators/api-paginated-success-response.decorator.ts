import type { ReferenceObject, SchemaObject } from '@nestjs/swagger'

import { ApiSuccessResponse } from './api-success-response.decorator.js'

/**
 * 分页成功响应装饰器配置
 */
export interface ApiPaginatedSuccessResponseOptions {
  /** 分页列表中单条数据的 Schema */
  itemSchema: SchemaObject | ReferenceObject

  /** Swagger 响应描述 */
  description?: string

  /** HTTP 状态码，默认 200 */
  status?: number
}

/**
 * Swagger 分页成功响应装饰器
 *
 * 自动生成：
 * {
 *   code: 0,
 *   data: {
 *     list: T[],
 *     total: number
 *   },
 *   message: string
 * }
 */
export function ApiPaginatedSuccessResponse({
  itemSchema,
  description = '分页查询成功',
  status = 200,
}: ApiPaginatedSuccessResponseOptions): MethodDecorator & ClassDecorator {
  return ApiSuccessResponse({
    description,
    status,
    dataSchema: {
      type: 'object',
      required: ['list', 'total'],
      properties: {
        list: {
          type: 'array',
          items: itemSchema,
        },
        total: {
          type: 'integer',
          minimum: 0,
          example: 0,
        },
      },
    },
  })
}
