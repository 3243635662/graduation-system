import { z } from 'zod'

/** 七个预置角色编码（与 shared RoleCode 保持一致，测试中有覆盖校验） */
export const assignableRoleCodeSchema = z.enum([
  'PLATFORM_SUPER_ADMIN',
  'SCHOOL_ADMIN',
  'DEPARTMENT_ADMIN',
  'MAJOR_ADMIN',
  'CLASS_COORDINATOR',
  'TEACHER',
  'STUDENT',
])

export const assignRoleSchema = z.object({
  userId: z.uuid(),
  roleCode: assignableRoleCodeSchema,
  /** 角色生效的组织节点；仅 SCHOOL/DEPARTMENT/MAJOR/CLASS 角色需要 */
  scopeOrgUnitId: z.uuid().nullish(),
  /**
   * 过期时间（ISO 8601 字符串），缺省表示长期有效。
   *
   * 这里刻意不使用 z.coerce.date()：Date 无法被转换成 JSON Schema，
   * 会导致 Swagger 在应用启动时直接抛错。
   */
  validUntil: z.iso.datetime({ offset: true }).nullish(),
})

export type AssignRoleBody = z.infer<typeof assignRoleSchema>

export const userAssignmentsQuerySchema = z.object({
  includeRevoked: z.enum(['true', 'false']).optional(),
})

export type UserAssignmentsQuery = z.infer<typeof userAssignmentsQuerySchema>
