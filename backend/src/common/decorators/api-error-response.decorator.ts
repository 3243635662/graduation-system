import { ApiResponse as SwaggerApiResponse } from '@nestjs/swagger'
import type { ReferenceObject, SchemaObject } from '@nestjs/swagger'

/**
 * 统一错误响应装饰器配置
 */
export interface ApiErrorResponseOptions {
  /** HTTP 状态码 */
  status: number

  /** 业务错误码 */
  code: number

  /** 错误消息 */
  message: string

  /** Swagger 响应描述 */
  description?: string

  /** data 字段的数据结构，默认表示 null */
  dataSchema?: SchemaObject | ReferenceObject
}

/**
 * Swagger 统一错误响应装饰器
 *
 * 自动生成：
 * {
 *   code: number,
 *   data: null,
 *   message: string
 * }
 */
export function ApiErrorResponse({
  status,
  code,
  message,
  description = message,
  dataSchema = {
    type: 'object',
    nullable: true,
    example: null,
  },
}: ApiErrorResponseOptions): MethodDecorator & ClassDecorator {
  return SwaggerApiResponse({
    status,
    description,
    schema: {
      type: 'object',
      required: ['code', 'data', 'message'],
      properties: {
        code: {
          type: 'integer',
          enum: [code],
          example: code,
          description: '业务错误码',
        },
        data: dataSchema,
        message: {
          type: 'string',
          example: message,
        },
      },
    },
  })
}
