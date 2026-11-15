import { z } from 'zod'

import { paginationSchema } from '../../common/schemas/pagination.schema.js'

export const userRoleCodeSchema = z.enum([
  'PLATFORM_SUPER_ADMIN',
  'SCHOOL_ADMIN',
  'DEPARTMENT_ADMIN',
  'MAJOR_ADMIN',
  'CLASS_COORDINATOR',
  'TEACHER',
  'STUDENT',
])

export const userStatusSchema = z.enum(['ACTIVE', 'DISABLED', 'LOCKED'])

export const userListQuerySchema = paginationSchema.extend({
  /** 姓名或邮箱模糊搜索 */
  keyword: z.string().trim().min(1).max(100).optional(),
  status: userStatusSchema.optional(),
  /** 只匹配当前有效角色 */
  roleCode: userRoleCodeSchema.optional(),
  /** 在授权范围内进一步收窄到某个组织节点及其子树 */
  orgUnitId: z.uuid().optional(),
})

export type UserListQuery = z.infer<typeof userListQuerySchema>
