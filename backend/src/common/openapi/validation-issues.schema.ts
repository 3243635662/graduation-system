import type { SchemaObject } from '@nestjs/swagger'

/**
 * 参数校验失败响应中 data 的 OpenAPI 文档结构
 *
 * 对应全局 StandardSchemaValidationPipe 抛出的 400 / code 40001，
 * data 为字段级错误数组。仅用于描述响应形状，不参与运行时校验。
 */
export const validationIssuesSchema: SchemaObject = {
  type: 'array',
  items: {
    type: 'object',
    required: ['path', 'message'],
    properties: {
      path: {
        type: 'string',
        example: 'id',
      },
      message: {
        type: 'string',
        example: 'Invalid UUID',
      },
    },
  },
}
