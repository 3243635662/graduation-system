import type { SchemaObject } from '@nestjs/swagger'

/**
 * Auth 模块响应的 OpenAPI 文档结构
 *
 * 仅用于生成 Swagger 文档，不参与运行时校验或序列化。
 */

export const roleSummarySchema: SchemaObject = {
  type: 'object',
  required: ['id', 'code', 'name'],
  properties: {
    id: {
      type: 'string',
      format: 'uuid',
    },
    code: {
      type: 'string',
      example: 'STUDENT',
    },
    name: {
      type: 'string',
      example: '学生',
    },
  },
}

export const authUserSchema: SchemaObject = {
  type: 'object',
  required: ['id', 'email', 'displayName', 'status', 'roles'],
  properties: {
    id: {
      type: 'string',
      format: 'uuid',
    },
    email: {
      type: 'string',
      format: 'email',
      example: 'student@example.com',
    },
    displayName: {
      type: 'string',
      example: '张三',
    },
    status: {
      type: 'string',
      enum: ['ACTIVE', 'DISABLED', 'LOCKED'],
      example: 'ACTIVE',
    },
    roles: {
      type: 'array',
      items: roleSummarySchema,
    },
  },
}

export const sendEmailCodeResultSchema: SchemaObject = {
  type: 'object',
  required: ['expiresIn', 'resendAfter'],
  properties: {
    expiresIn: {
      type: 'integer',
      description: '验证码有效期（秒）',
      example: 120,
    },
    resendAfter: {
      type: 'integer',
      description: '允许重新发送的冷却时间（秒）',
      example: 60,
    },
  },
}

export const authResultSchema: SchemaObject = {
  type: 'object',
  required: ['accessToken', 'user'],
  properties: {
    accessToken: {
      type: 'string',
      description: 'Access Token（JWT，默认 15 分钟有效，仅存前端内存）',
    },
    user: authUserSchema,
  },
}
