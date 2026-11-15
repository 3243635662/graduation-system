import { PermissionCode } from '@graduation/shared'
import type { AuditJsonValue, AuditResult, AuditSource, AuditActorType } from '@graduation/shared'
import { ForbiddenException, Injectable } from '@nestjs/common'

import type { Prisma } from '../../../generated/prisma/client.js'
import { paginate } from '../../common/utils/pagination.util.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import {
  OrganizationScopeService,
  type OrganizationScope,
} from '../rbac/authorization/organization-scope.service.js'
import type { AuditLogListQuery } from './audit-log.schema.js'

const AUDIT_LOG_SELECT = {
  id: true,
  actorType: true,
  actorUserId: true,
  actorLabel: true,
  action: true,
  targetType: true,
  targetId: true,
  scopeOrgUnitId: true,
  result: true,
  source: true,
  before: true,
  after: true,
  reason: true,
  requestId: true,
  createdAt: true,
  actor: { select: { realName: true } },
} as const

export interface AuditLogListItem {
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
  createdAt: Date
}

/**
 * 审计日志查询（只读）
 *
 * 数据范围规则与项目既有约定一致：
 * - GLOBAL 范围（ALL）：不做组织过滤；
 * - 组织范围（SUBTREE）：只返回 scopeOrgUnitId 落在范围内的记录；
 * - 无有效范围（NONE）：直接 403，不返回空列表掩盖授权缺失。
 *
 * 不在组织范围内的记录（例如系统任务）只对 GLOBAL 范围可见，
 * 避免院系/专业管理员通过审计接口旁路看到其他组织的数据。
 */
@Injectable()
export class AuditLogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scopeService: OrganizationScopeService,
  ) {}

  async list(
    actorId: string,
    query: AuditLogListQuery,
  ): Promise<{ total: number; list: AuditLogListItem[] }> {
    const scope = await this.scopeService.resolve(actorId, PermissionCode.AUDIT_LOG_READ)

    if (scope.kind === 'NONE') {
      throw new ForbiddenException({
        code: 40300,
        data: null,
        message: '没有查询审计日志的权限范围',
      })
    }

    const where = this.buildWhere(query, scope)

    const result = await paginate(
      query,
      (args) =>
        this.prisma.auditLog.findMany({
          where,
          select: AUDIT_LOG_SELECT,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          ...args,
        }),
      () => this.prisma.auditLog.count({ where }),
    )

    return {
      total: result.total,
      list: result.list.map((row) => this.toListItem(row)),
    }
  }

  private buildWhere(
    query: AuditLogListQuery,
    scope: OrganizationScope,
  ): Prisma.AuditLogWhereInput {
    const where: Prisma.AuditLogWhereInput = {}

    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: query.from } : {}),
        ...(query.to ? { lte: query.to } : {}),
      }
    }

    if (query.actorUserId) where.actorUserId = query.actorUserId
    if (query.action) where.action = query.action
    if (query.targetType) where.targetType = query.targetType
    if (query.targetId) where.targetId = query.targetId
    if (query.requestId) where.requestId = query.requestId
    if (query.source) where.source = query.source
    if (query.result) where.result = query.result

    // 失败关闭：只有明确的全量范围才不加组织条件
    if (scope.kind === 'SUBTREE') {
      where.scopeOrgUnitId = { in: scope.orgUnitIds }
    }

    return where
  }

  private toListItem(
    row: Prisma.AuditLogGetPayload<{ select: typeof AUDIT_LOG_SELECT }>,
  ): AuditLogListItem {
    return {
      id: row.id,
      actorType: row.actorType,
      actorUserId: row.actorUserId,
      actorLabel: row.actorLabel,
      actorName: row.actor?.realName ?? null,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      scopeOrgUnitId: row.scopeOrgUnitId,
      result: row.result,
      source: row.source,
      before: this.toAuditJson(row.before),
      after: this.toAuditJson(row.after),
      reason: row.reason,
      requestId: row.requestId,
      createdAt: row.createdAt,
    }
  }

  /** 写入时已通过 sanitizeAuditPayload，这里按只读契约返回 */
  private toAuditJson(value: Prisma.JsonValue | null): AuditJsonValue | null {
    return (value ?? null) as unknown as AuditJsonValue | null
  }
}
