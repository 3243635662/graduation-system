import type { SchemaObject } from '@nestjs/swagger'

/**
 * 组织节点 OpenAPI 结构
 *
 * 仅用于生成 Swagger 文档，不参与运行时校验。
 * children 为同结构数组，文档中只展开一层以避免无限递归。
 */
export const organizationTreeNodeSchema: SchemaObject = {
  type: 'object',
  required: ['id', 'name', 'code', 'type', 'status', 'sortOrder', 'parentId', 'children'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string', example: '计算机学院' },
    code: { type: 'string', example: 'CS' },
    type: {
      type: 'string',
      enum: ['SCHOOL', 'DEPARTMENT', 'MAJOR', 'CLASS'],
      example: 'DEPARTMENT',
    },
    status: {
      type: 'string',
      enum: ['ACTIVE', 'DISABLED'],
      example: 'ACTIVE',
    },
    sortOrder: { type: 'integer', example: 1 },
    parentId: { type: 'string', format: 'uuid', nullable: true },
    children: {
      type: 'array',
      items: { type: 'object', description: '同结构组织节点' },
    },
  },
}
