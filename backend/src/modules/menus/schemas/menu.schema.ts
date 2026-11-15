import type { MenuTreeNode } from '@graduation/shared'
import { MENU_CACHE_SCHEMA_VERSION } from '@graduation/shared'
import type { SchemaObject } from '@nestjs/swagger'
import { z } from 'zod'

import type { CachedMenuEntry } from '../types/menu-cache.type.js'

/**
 * componentKey 只允许「相对路径 + 字母数字下划线连字符」
 *
 * 真正的白名单在前端 import.meta.glob 注册表，这里再挡一层，
 * 防止缓存被写入 `../../etc/passwd` 或绝对 URL 一类可疑值。
 */
const COMPONENT_KEY_PATTERN = /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/

/**
 * 菜单节点运行时校验
 *
 * 用于校验从 Redis 反序列化出来的数据：缓存可能被外部污染或结构过期，
 * 不能把未经校验的 JSON 直接当作菜单树返回给前端。
 */
export const menuTreeNodeZodSchema: z.ZodType<MenuTreeNode> = z.lazy(() =>
  z.object({
    id: z.string().optional(),
    parentId: z.string().nullable().optional(),
    code: z.string().min(1),
    title: z.string().min(1),
    // PAGE 的路由地址必须是站内绝对路径，禁止协议相对/外链
    path: z.string().startsWith('/').nullable(),
    type: z.enum(['DIRECTORY', 'PAGE']),
    icon: z.string().optional(),
    componentKey: z.string().regex(COMPONENT_KEY_PATTERN).optional(),
    sortOrder: z.number().int(),
    visible: z.boolean().optional(),
    children: z.array(menuTreeNodeZodSchema).optional(),
  }),
)

/** 缓存负载结构 */
export const cachedMenuEntryZodSchema = z.object({
  schemaVersion: z.number().int(),
  userId: z.string().min(1),
  generatedAt: z.string().min(1),
  menus: z.array(menuTreeNodeZodSchema),
})

/**
 * 解析并校验缓存字符串
 *
 * 返回 null 表示缓存不可用（JSON 非法、结构不符或版本不匹配），
 * 调用方必须删除该 Key 并回源数据库，绝不能把可疑数据返回给用户。
 */
export function parseCachedMenuEntry(raw: string): CachedMenuEntry | null {
  let parsed: unknown

  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  const result = cachedMenuEntryZodSchema.safeParse(parsed)

  if (!result.success) return null
  if (result.data.schemaVersion !== MENU_CACHE_SCHEMA_VERSION) return null

  return {
    schemaVersion: result.data.schemaVersion,
    userId: result.data.userId,
    generatedAt: result.data.generatedAt,
    menus: result.data.menus,
  }
}

/**
 * 菜单节点的 OpenAPI 文档结构
 *
 * 仅用于生成 Swagger 文档，不参与运行时校验。
 * children 只展开一层，避免 Swagger 中出现循环 $ref。
 */
export const menuTreeNodeSchema: SchemaObject = {
  type: 'object',
  required: ['code', 'title', 'path', 'type', 'sortOrder'],
  properties: {
    id: {
      type: 'string',
      format: 'uuid',
      description: '菜单主键，用于去重',
    },
    parentId: {
      type: 'string',
      format: 'uuid',
      nullable: true,
      description: '父节点主键，根节点为 null',
    },
    code: {
      type: 'string',
      description: '菜单编码，同时作为前端路由 name',
      example: 'DASHBOARD',
    },
    title: {
      type: 'string',
      description: '菜单标题',
      example: '工作台',
    },
    path: {
      type: 'string',
      nullable: true,
      description: '路由地址，DIRECTORY 为 null',
      example: '/dashboard',
    },
    type: {
      type: 'string',
      enum: ['DIRECTORY', 'PAGE'],
      description: 'DIRECTORY 仅用于导航分组，PAGE 才生成业务路由',
      example: 'PAGE',
    },
    icon: {
      type: 'string',
      description: 'lucide 图标名',
      example: 'LayoutDashboard',
    },
    componentKey: {
      type: 'string',
      description: '对应前端 src/views 下的页面文件路径（不含 .vue）',
      example: 'dashboard/index',
    },
    sortOrder: {
      type: 'integer',
      description: '同级排序，升序',
      example: 1,
    },
    visible: {
      type: 'boolean',
      description: '是否在侧边栏显示（false 仅隐藏导航，不代表撤销授权）',
      example: true,
    },
    children: {
      type: 'array',
      description: '子节点',
      items: {
        type: 'object',
        properties: {
          code: { type: 'string' },
          title: { type: 'string' },
          path: { type: 'string', nullable: true },
          type: { type: 'string', enum: ['DIRECTORY', 'PAGE'] },
          icon: { type: 'string' },
          componentKey: { type: 'string' },
          sortOrder: { type: 'integer' },
          visible: { type: 'boolean' },
        },
      },
    },
  },
}
