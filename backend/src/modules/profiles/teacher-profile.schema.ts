import { z } from 'zod'

import { paginationSchema } from '../../common/schemas/pagination.schema.js'
import { employmentStatusSchema } from './personnel-profile.schema.js'

/**
 * 教师档案契约（Phase 1）
 *
 * - 创建教师身份时必须指定已存在的工作人员档案，账号与正式组织从档案读取；
 * - 教师编号唯一，可修改；职称与专业资料可清空（传 null）；
 * - 在职状态变更走独立接口，与工作人员任职状态同步。
 */
export const teacherProfileListQuerySchema = paginationSchema.extend({
  keyword: z.string().trim().min(1).max(100).optional(),
  teacherNo: z.string().trim().min(1).max(32).optional(),
  realName: z.string().trim().min(1).max(50).optional(),
  /** 教师正式组织归属节点：只能是授权范围内的收窄条件 */
  organizationId: z.uuid().optional(),
  employmentStatus: employmentStatusSchema.optional(),
})

export const createTeacherProfileSchema = z.object({
  personnelProfileId: z.uuid('必须绑定一个已存在的工作人员档案'),
  teacherNo: z.string().trim().min(1, '教师编号不能为空').max(32, '教师编号最多 32 个字符'),
  title: z.string().trim().max(64, '职称最多 64 个字符').nullable().optional(),
  professionalInfo: z.string().trim().max(500, '专业资料最多 500 个字符').nullable().optional(),
})

export const updateTeacherProfileSchema = z.object({
  teacherNo: z
    .string()
    .trim()
    .min(1, '教师编号不能为空')
    .max(32, '教师编号最多 32 个字符')
    .optional(),
  title: z.string().trim().max(64, '职称最多 64 个字符').nullable().optional(),
  professionalInfo: z.string().trim().max(500, '专业资料最多 500 个字符').nullable().optional(),
})

export const updateTeacherEmploymentStatusSchema = z.object({
  employmentStatus: employmentStatusSchema,
})

export type TeacherProfileListQuery = z.infer<typeof teacherProfileListQuerySchema>
export type CreateTeacherProfileBody = z.infer<typeof createTeacherProfileSchema>
export type UpdateTeacherProfileBody = z.infer<typeof updateTeacherProfileSchema>
export type UpdateTeacherEmploymentStatusBody = z.infer<typeof updateTeacherEmploymentStatusSchema>
