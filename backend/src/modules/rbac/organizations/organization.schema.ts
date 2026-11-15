import { z } from 'zod'

/** 与 Prisma OrganizationType 保持一致 */
export const organizationTypeSchema = z.enum(['SCHOOL', 'DEPARTMENT', 'MAJOR', 'CLASS'])

export const organizationStatusSchema = z.enum(['ACTIVE', 'DISABLED'])

/** 组织编码规则：字母、数字、下划线、短横线，全局唯一 */
export const organizationCodeSchema = z
  .string()
  .trim()
  .min(1, '请输入组织编码')
  .max(64, '组织编码不能超过 64 个字符')
  .regex(/^[A-Za-z0-9_-]+$/, '组织编码只能包含字母、数字、下划线和短横线')

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(1, '请输入组织名称').max(100, '组织名称不能超过 100 个字符'),
  code: organizationCodeSchema,
  type: organizationTypeSchema,
  parentId: z.uuid().nullish(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
})

export type CreateOrganizationBody = z.infer<typeof createOrganizationSchema>

export const updateOrganizationSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, '请输入组织名称')
      .max(100, '组织名称不能超过 100 个字符')
      .optional(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
    status: organizationStatusSchema.optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined || value.sortOrder !== undefined || value.status !== undefined,
    { message: '至少需要提供一个待修改字段' },
  )

export type UpdateOrganizationBody = z.infer<typeof updateOrganizationSchema>

/**
 * 组织树查询参数
 *
 * 不用 z.coerce.boolean()：它会把字符串 "false" 转成 true。
 */
export const organizationTreeQuerySchema = z.object({
  includeDisabled: z.enum(['true', 'false']).optional(),
})

export type OrganizationTreeQuery = z.infer<typeof organizationTreeQuerySchema>
