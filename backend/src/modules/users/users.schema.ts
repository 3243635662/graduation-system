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

/**
 * 真实姓名。
 *
 * 毕设系统统一使用真名，不提供昵称/显示名。
 */
const realNameSchema = z
  .string()
  .trim()
  .min(2, '真实姓名至少 2 个字符')
  .max(50, '真实姓名最多 50 个字符')
  .regex(/^[\u4e00-\u9fa5A-Za-z·\s]+$/, '真实姓名只能包含中文、英文字母、间隔号或空格')

const phoneSchema = z
  .string()
  .trim()
  .max(32, '手机号最多 32 个字符')
  .regex(/^[0-9+\-\s()]*$/, '手机号格式不正确')

/**
 * 头像地址只接受 http(s)。
 *
 * 明确拒绝 javascript: / data: 等可执行 scheme。
 */
const avatarUrlSchema = z
  .string()
  .trim()
  .max(2048, '头像地址最多 2048 个字符')
  .refine(
    (value) => value === '' || /^https?:\/\//i.test(value),
    '头像地址必须是 http 或 https 开头的链接',
  )

/** 修改本人公共资料 */
export const updateMyProfileSchema = z
  .object({
    realName: realNameSchema.optional(),
    phone: phoneSchema.nullable().optional(),
    avatarUrl: avatarUrlSchema.nullable().optional(),
  })
  .refine(
    (data) =>
      data.realName !== undefined || data.phone !== undefined || data.avatarUrl !== undefined,
    '至少需要修改一项资料',
  )

/** 管理员修改账号：不允许改学号、工号、班级与组织归属 */
export const updateUserAccountSchema = z
  .object({
    status: userStatusSchema.optional(),
    realName: realNameSchema.optional(),
    phone: phoneSchema.nullable().optional(),
    avatarUrl: avatarUrlSchema.nullable().optional(),
  })
  .refine(
    (data) =>
      data.status !== undefined ||
      data.realName !== undefined ||
      data.phone !== undefined ||
      data.avatarUrl !== undefined,
    '至少需要修改一项内容',
  )

export type UserListQuery = z.infer<typeof userListQuerySchema>
export type UpdateMyProfileBody = z.infer<typeof updateMyProfileSchema>
export type UpdateUserAccountBody = z.infer<typeof updateUserAccountSchema>
