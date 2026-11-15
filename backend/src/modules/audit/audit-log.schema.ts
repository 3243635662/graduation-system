import { AUDIT_RESULTS, AUDIT_SOURCES } from '@graduation/shared'
import { z } from 'zod'

import { paginationSchema } from '../../common/schemas/pagination.schema.js'

/**
 * 审计日志查询参数
 *
 * - 分页复用公共 Schema；
 * - 时间范围为闭区间，只接受可解析的日期字符串；
 * - 所有条件都只是在授权范围内收窄，不能扩大范围。
 */
export const auditLogListQuerySchema = paginationSchema
  .extend({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    actorUserId: z.uuid().optional(),
    action: z.string().trim().min(1).max(128).optional(),
    targetType: z.string().trim().min(1).max(64).optional(),
    targetId: z.string().trim().min(1).max(64).optional(),
    requestId: z.string().trim().min(1).max(64).optional(),
    source: z.enum(AUDIT_SOURCES).optional(),
    result: z.enum(AUDIT_RESULTS).optional(),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: '开始时间不能晚于结束时间',
    path: ['from'],
  })

export type AuditLogListQuery = z.infer<typeof auditLogListQuerySchema>
