import { apiRequest } from '@/lib/api-client'
import { toQueryParams } from '@/lib/query'
import type { AuditLogItem, AuditLogListQuery, PaginatedData } from '@graduation/shared'

/** 审计日志接口（只读，不提供创建/修改/删除） */
export function listAuditLogs(query: AuditLogListQuery): Promise<PaginatedData<AuditLogItem>> {
  return apiRequest<PaginatedData<AuditLogItem>>('/audit-logs', {
    method: 'GET',
    query: toQueryParams(query),
  })
}
