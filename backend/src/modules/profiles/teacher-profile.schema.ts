import { z } from 'zod'

import { paginationSchema } from '../../common/schemas/pagination.schema.js'

export const employmentStatusSchema = z.enum(['ACTIVE', 'ON_LEAVE', 'LEFT'])

export const teacherProfileListQuerySchema = paginationSchema.extend({
  keyword: z.string().trim().min(1).max(100).optional(),
  teacherNo: z.string().trim().min(1).max(32).optional(),
  name: z.string().trim().min(1).max(80).optional(),
  departmentId: z.uuid().optional(),
  employmentStatus: employmentStatusSchema.optional(),
})

export const createTeacherProfileSchema = z.object({
  userId: z.uuid(),
  teacherNo: z.string().trim().min(1, '工号不能为空').max(32),
  departmentId: z.uuid(),
})

export const adjustTeacherDepartmentSchema = z.object({
  departmentId: z.uuid(),
})

export const updateTeacherEmploymentStatusSchema = z.object({
  employmentStatus: employmentStatusSchema,
})

export type TeacherProfileListQuery = z.infer<typeof teacherProfileListQuerySchema>
export type CreateTeacherProfileBody = z.infer<typeof createTeacherProfileSchema>
export type AdjustTeacherDepartmentBody = z.infer<typeof adjustTeacherDepartmentSchema>
export type UpdateTeacherEmploymentStatusBody = z.infer<typeof updateTeacherEmploymentStatusSchema>
