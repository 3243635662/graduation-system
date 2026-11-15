import type { SchemaObject } from '@nestjs/swagger'

/**
 * 角色对象的 OpenAPI 文档结构
 *
 * 描述接口响应中角色的形状，供列表与详情接口复用；
 * 仅用于生成 Swagger 文档，不参与运行时校验或序列化。
 * 若 RolesService 返回字段有变，需同步更新此处。
 */
export const roleSchema: SchemaObject = {
  type: 'object',
  required: [
    'id',
    'code',
    'name',
    'description',
    'dataScope',
    'isSystem',
    'status',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    id: {
      type: 'string',
      format: 'uuid',
    },
    code: {
      type: 'string',
      example: 'SCHOOL_ADMIN',
    },
    name: {
      type: 'string',
      example: '学校管理员',
    },
    description: {
      type: 'string',
      nullable: true,
    },
    dataScope: {
      type: 'string',
      enum: ['GLOBAL', 'SCHOOL', 'DEPARTMENT', 'MAJOR', 'CLASS', 'ASSIGNED', 'SELF'],
      example: 'SCHOOL',
      description: '角色默认数据范围维度，不代表自动拥有该范围内所有资源的权限',
    },
    isSystem: {
      type: 'boolean',
      example: true,
    },
    status: {
      type: 'string',
      enum: ['ACTIVE', 'DISABLED'],
      example: 'ACTIVE',
    },
    createdAt: {
      type: 'string',
      format: 'date-time',
    },
    updatedAt: {
      type: 'string',
      format: 'date-time',
    },
  },
}
