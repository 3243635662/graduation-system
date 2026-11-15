import { z } from 'zod'

import { paginationSchema } from '../../common/schemas/pagination.schema.js'

export const enrollmentStatusSchema = z.enum(['ACTIVE', 'SUSPENDED', 'GRADUATED', 'WITHDRAWN'])

export const studentProfileListQuerySchema = paginationSchema.extend({
  keyword: z.string().trim().min(1).max(100).optional(),
  studentNo: z.string().trim().min(1).max(32).optional(),
  name: z.string().trim().min(1).max(80).optional(),
  classId: z.uuid().optional(),
  orgUnitId: z.uuid().optional(),
  enrollmentStatus: enrollmentStatusSchema.optional(),
  hasAccount: z.enum(['true', 'false']).optional(),
})

export const createStudentProfileSchema = z.object({
  name: z.string().trim().min(1, '姓名不能为空').max(80),
  studentNo: z.string().trim().min(1, '学号不能为空').max(32),
  classId: z.uuid(),
})

export const updateStudentProfileSchema = z.object({
  name: z.string().trim().min(1, '姓名不能为空').max(80),
})

export const transferStudentProfileSchema = z.object({
  targetClassId: z.uuid(),
  reason: z.string().trim().min(1, '转班原因不能为空').max(255, '转班原因不能超过 255 个字符'),
})

export const updateEnrollmentStatusSchema = z.object({
  enrollmentStatus: enrollmentStatusSchema,
})

export type StudentProfileListQuery = z.infer<typeof studentProfileListQuerySchema>
export type CreateStudentProfileBody = z.infer<typeof createStudentProfileSchema>
export type UpdateStudentProfileBody = z.infer<typeof updateStudentProfileSchema>
export type TransferStudentProfileBody = z.infer<typeof transferStudentProfileSchema>
export type UpdateEnrollmentStatusBody = z.infer<typeof updateEnrollmentStatusSchema>
