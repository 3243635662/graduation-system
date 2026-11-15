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
    scopeOrgUnitId: {
      type: 'string',
      format: 'uuid',
      nullable: true,
      description: '角色生效的组织节点；null 表示该角色不绑定组织范围',
    },
    scopeOrgUnitName: {
      type: 'string',
      nullable: true,
      example: '软件工程一班',
    },
    scopeOrgUnitType: {
      type: 'string',
      nullable: true,
      enum: ['SCHOOL', 'DEPARTMENT', 'MAJOR', 'CLASS'],
    },
    validUntil: {
      type: 'string',
      format: 'date-time',
      nullable: true,
      description: '角色分配过期时间；null 表示长期有效',
    },
  },
}

export const authUserSchema: SchemaObject = {
  type: 'object',
  required: ['id', 'email', 'realName', 'status', 'roles', 'permissions'],
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
    phone: {
      type: 'string',
      nullable: true,
      description: '手机号；未登记时为 null',
      example: '13800138000',
    },
    realName: {
      type: 'string',
      description: '真实姓名（系统统一使用真名，不使用昵称或显示名）',
      example: '张三',
    },
    avatarUrl: {
      type: 'string',
      format: 'uri',
      nullable: true,
      description: '头像地址；未上传时为 null',
      example: 'https://cdn.example.com/avatars/zhangsan.png',
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
    permissions: {
      type: 'array',
      description: '当前有效角色的功能权限编码并集，仅用于前端控制入口可见性',
      items: { type: 'string', example: 'student:profile:read' },
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
