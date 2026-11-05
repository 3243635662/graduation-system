import { ApiResponse } from '@nestjs/swagger'
import type { ReferenceObject, SchemaObject } from '@nestjs/swagger'

/**
 * 统一成功响应装饰器配置
 */
export interface ApiSuccessResponseOptions {
  /** data 字段对应的数据结构 */
  dataSchema: SchemaObject | ReferenceObject

  /** Swagger 响应描述 */
  description?: string

  /** HTTP 状态码，默认 200 */
  status?: number
}

/**
 * Swagger 统一成功响应装饰器
 *
 * 自动生成：
 * {
 *   code: 0,
 *   data: T,
 *   message: string
 * }
 */
export function ApiSuccessResponse({
  dataSchema,
  description = '统一成功响应',
  status = 200,
}: ApiSuccessResponseOptions): MethodDecorator & ClassDecorator {
  return ApiResponse({
    status,
    description,
    schema: {
      type: 'object',
      required: ['code', 'data', 'message'],
      properties: {
        code: {
          type: 'integer',
          enum: [0],
          description: '业务状态码，0 表示成功',
          example: 0,
        },
        data: dataSchema,
        message: {
          type: 'string',
          description: '响应消息',
          example: '请求成功',
        },
      },
    },
  })
}
