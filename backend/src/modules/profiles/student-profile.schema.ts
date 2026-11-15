import { z } from 'zod'

import { idParamSchema } from '../../common/schemas/id-param.schema.js'
import { paginationSchema } from '../../common/schemas/pagination.schema.js'

const enrollmentStatusSchema = z.enum(['ACTIVE', 'SUSPENDED', 'GRADUATED', 'WITHDRAWN'])

export const studentProfileListQuerySchema = paginationSchema.extend({
  keyword: z.string().trim().min(1).max(100).optional(),
  studentNo: z.string().trim().min(1).max(32).optional(),
  realName: z.string().trim().min(1).max(50).optional(),
  classId: z.uuid().optional(),
  orgUnitId: z.uuid().optional(),
  enrollmentStatus: enrollmentStatusSchema.optional(),
  /** 只看尚未分班的学生 */
  unassignedOnly: z.enum(['true', 'false']).optional(),
})

export const createStudentProfileSchema = z.object({
  userId: z.uuid('必须绑定一个已存在的用户账号'),
  studentNo: z.string().trim().min(1, '学号不能为空').max(32, '学号最多 32 个字符'),
  classId: z.uuid().optional().nullable(),
  enrollmentYear: z.number().int().min(1900).max(2200).optional().nullable(),
})

export const updateStudentProfileSchema = z.object({
  studentNo: z.string().trim().min(1, '学号不能为空').max(32, '学号最多 32 个字符').optional(),
  enrollmentYear: z.number().int().min(1900).max(2200).optional().nullable(),
})

export const transferStudentProfileSchema = z.object({
  targetClassId: z.uuid(),
  reason: z.string().trim().min(1, '分班或转班原因不能为空').max(255, '原因不能超过 255 个字符'),
})

export const updateEnrollmentStatusSchema = z.object({
  enrollmentStatus: enrollmentStatusSchema,
})

export type StudentProfileListQuery = z.infer<typeof studentProfileListQuerySchema>
export type CreateStudentProfileBody = z.infer<typeof createStudentProfileSchema>
export type UpdateStudentProfileBody = z.infer<typeof updateStudentProfileSchema>
export type TransferStudentProfileBody = z.infer<typeof transferStudentProfileSchema>
export type UpdateEnrollmentStatusBody = z.infer<typeof updateEnrollmentStatusSchema>
export type StudentProfileIdParam = z.infer<typeof idParamSchema>
