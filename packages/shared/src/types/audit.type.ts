import type { PaginationQuery } from './pagination.type.js'

/**
 * 审计日志契约，前后端共用
 *
 * 与后端 Prisma 枚举及 audit_logs 表保持一致；
 * 只读接口不提供创建、修改、删除能力。
 */

export const AUDIT_ACTOR_TYPES = ['USER', 'SYSTEM'] as const
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number]

export const AUDIT_SOURCES = ['WEB', 'IMPORT', 'SYSTEM'] as const
export type AuditSource = (typeof AUDIT_SOURCES)[number]

export const AUDIT_RESULTS = ['SUCCESS', 'FAILURE'] as const
export type AuditResult = (typeof AUDIT_RESULTS)[number]

/** 审计快照允许的 JSON 原始值：禁止类实例、Date、二进制等非 JSON 值 */
export type AuditJsonValue =
  | string
  | number
  | boolean
  | null
  | AuditJsonValue[]
  | { [key: string]: AuditJsonValue }

/** 审计日志查询参数；时间范围为闭区间，字符串为 ISO 8601 */
export interface AuditLogListQuery extends PaginationQuery {
  from?: string
  to?: string
  actorUserId?: string
  action?: string
  targetType?: string
  targetId?: string
  requestId?: string
  source?: AuditSource
  result?: AuditResult
}

/** 审计日志列表项（只读） */
export interface AuditLogItem {
  id: string
  actorType: AuditActorType
  actorUserId: string | null
  actorLabel: string | null
  actorName: string | null
  action: string
  targetType: string
  targetId: string | null
  scopeOrgUnitId: string | null
  result: AuditResult
  source: AuditSource
  before: AuditJsonValue | null
  after: AuditJsonValue | null
  reason: string | null
  requestId: string | null
  createdAt: string
}
