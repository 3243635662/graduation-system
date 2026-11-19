import { AUDIT_RESULTS, AUDIT_SOURCES } from '@graduation/shared'
import { z } from 'zod'

import { paginationSchema } from '../../common/schemas/pagination.schema.js'

/**
 * 审计日志查询参数
 *
 * - 分页复用公共 Schema；
 * - 时间范围为闭区间，用 ISO 8601 字符串表达；
 *   不使用 z.date()/z.coerce.date()，因为 Date 无法转换成 JSON Schema，
 *   会让 Swagger 在应用启动阶段直接抛错；
 * - 时间解析与先后校验在服务层完成；
 * - 所有条件都只是在授权范围内收窄，不能扩大范围。
 */
export const auditLogListQuerySchema = paginationSchema
  .extend({
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    actorUserId: z.uuid().optional(),
    action: z.string().trim().min(1).max(128).optional(),
    targetType: z.string().trim().min(1).max(64).optional(),
    targetId: z.string().trim().min(1).max(64).optional(),
    requestId: z.string().trim().min(1).max(64).optional(),
    source: z.enum(AUDIT_SOURCES).optional(),
    result: z.enum(AUDIT_RESULTS).optional(),
  })
  .refine(
    (query) =>
      !query.from || !query.to || new Date(query.from).getTime() <= new Date(query.to).getTime(),
    {
      message: '开始时间不能晚于结束时间',
      path: ['from'],
    },
  )

export type AuditLogListQuery = z.infer<typeof auditLogListQuerySchema>
