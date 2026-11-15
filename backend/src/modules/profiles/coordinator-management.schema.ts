import { z } from 'zod'

import { paginationSchema } from '../../common/schemas/pagination.schema.js'

export const coordinatorRecordStatusSchema = z.enum(['EFFECTIVE', 'REVOKED', 'ALL'])

export const teacherDutyListQuerySchema = paginationSchema.extend({
  teacherId: z.uuid().optional(),
  classId: z.uuid().optional(),
  dutyType: z.enum(['HEAD_TEACHER']).optional(),
  status: coordinatorRecordStatusSchema.default('EFFECTIVE'),
})

export const counselorListQuerySchema = paginationSchema.extend({
  userId: z.uuid().optional(),
  classId: z.uuid().optional(),
  status: coordinatorRecordStatusSchema.default('EFFECTIVE'),
})

export const coordinatorOverrideListQuerySchema = paginationSchema.extend({
  userId: z.uuid().optional(),
  classId: z.uuid().optional(),
  status: coordinatorRecordStatusSchema.default('EFFECTIVE'),
})

export type TeacherDutyListQuery = z.infer<typeof teacherDutyListQuerySchema>
export type CounselorListQuery = z.infer<typeof counselorListQuerySchema>
export type CoordinatorOverrideListQuery = z.infer<typeof coordinatorOverrideListQuerySchema>
