import { z } from 'zod'

import { paginationSchema } from '../../common/schemas/pagination.schema.js'

/** 任职状态：在职 / 休假（停薪留职） / 离职 */
export const employmentStatusSchema = z.enum(['ACTIVE', 'ON_LEAVE', 'LEFT'])

export const personnelProfileListQuerySchema = paginationSchema.extend({
  keyword: z.string().trim().min(1).max(100).optional(),
  employeeNo: z.string().trim().min(1).max(32).optional(),
  realName: z.string().trim().min(1).max(50).optional(),
  /** 正式组织归属节点：只能是授权范围内的收窄条件 */
  organizationId: z.uuid().optional(),
  status: employmentStatusSchema.optional(),
  /** 只看同时具备教师身份的工作人员 */
  teacherOnly: z.enum(['true', 'false']).optional(),
})

export const createPersonnelProfileSchema = z.object({
  userId: z.uuid('必须绑定一个已存在的用户账号'),
  employeeNo: z.string().trim().min(1, '工号不能为空').max(32, '工号最多 32 个字符').optional(),
  primaryOrganizationUnitId: z.uuid('必须指定正式组织归属'),
  positionName: z.string().trim().max(64, '岗位名称最多 64 个字符').optional(),
})

/**
 * 修改工作人员档案
 *
 * 只允许修改工号、岗位与正式组织归属，绑定账号不可变更；
 * 允许传 null 清空工号与岗位。
 */
export const updatePersonnelProfileSchema = z.object({
  employeeNo: z
    .string()
    .trim()
    .min(1, '工号不能为空')
    .max(32, '工号最多 32 个字符')
    .nullable()
    .optional(),
  positionName: z.string().trim().max(64, '岗位名称最多 64 个字符').nullable().optional(),
  primaryOrganizationUnitId: z.uuid().optional(),
})

export const updatePersonnelStatusSchema = z.object({
  status: employmentStatusSchema,
})

export type PersonnelProfileListQuery = z.infer<typeof personnelProfileListQuerySchema>
export type CreatePersonnelProfileBody = z.infer<typeof createPersonnelProfileSchema>
export type UpdatePersonnelProfileBody = z.infer<typeof updatePersonnelProfileSchema>
export type UpdatePersonnelStatusBody = z.infer<typeof updatePersonnelStatusSchema>
