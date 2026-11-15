import { z } from 'zod'

export const coordinatorEligibilityQuerySchema = z.object({
  userId: z.uuid(),
  classId: z.uuid(),
})

export const coordinatorClassQuerySchema = z.object({
  classId: z.uuid(),
  includeRevoked: z.enum(['true', 'false']).optional(),
})

export const coordinatorOverrideQuerySchema = z
  .object({
    userId: z.uuid().optional(),
    classId: z.uuid().optional(),
    includeRevoked: z.enum(['true', 'false']).optional(),
  })
  .refine((value) => Boolean(value.userId || value.classId), {
    message: '至少提供 userId 或 classId',
  })

const validUntilSchema = z.iso.datetime({ offset: true }).nullish()

export const createTeacherDutySchema = z.object({
  teacherId: z.uuid(),
  classId: z.uuid(),
  validFrom: z.iso.datetime({ offset: true }).optional(),
  validUntil: validUntilSchema,
})

export const createCounselorAssignmentSchema = z.object({
  userId: z.uuid(),
  classId: z.uuid(),
  validFrom: z.iso.datetime({ offset: true }).optional(),
  validUntil: validUntilSchema,
})

export const createCoordinatorOverrideSchema = z.object({
  userId: z.uuid(),
  classId: z.uuid(),
  reason: z.string().trim().min(1, '必须填写授权原因').max(255),
  validUntil: validUntilSchema,
})

export type CoordinatorEligibilityQuery = z.infer<typeof coordinatorEligibilityQuerySchema>
export type CoordinatorClassQuery = z.infer<typeof coordinatorClassQuerySchema>
export type CoordinatorOverrideQuery = z.infer<typeof coordinatorOverrideQuerySchema>
export type CreateTeacherDutyBody = z.infer<typeof createTeacherDutySchema>
export type CreateCounselorAssignmentBody = z.infer<typeof createCounselorAssignmentSchema>
export type CreateCoordinatorOverrideBody = z.infer<typeof createCoordinatorOverrideSchema>
