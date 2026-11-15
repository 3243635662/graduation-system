import { PermissionCode } from '@graduation/shared'
import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { SchemaObject } from '@nestjs/swagger'

import { ApiErrorResponse } from '../../common/decorators/api-error-response.decorator.js'
import { ApiPaginatedSuccessResponse } from '../../common/decorators/api-paginated-success-response.decorator.js'
import { validationIssuesSchema } from '../../common/openapi/validation-issues.schema.js'
import { CurrentUser } from '../auth/decorators/current-user.decorator.js'
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js'
import type { AuthUserContext } from '../auth/types/auth-user.type.js'
import { PermissionsGuard } from '../rbac/authorization/permissions.guard.js'
import { RequirePermissions } from '../rbac/authorization/require-permissions.decorator.js'
import { auditLogListQuerySchema, type AuditLogListQuery } from './audit-log.schema.js'
import { AuditLogService } from './audit-log.service.js'

const auditLogItemSchema: SchemaObject = {
  type: 'object',
  required: [
    'id',
    'actorType',
    'actorUserId',
    'actorLabel',
    'actorName',
    'action',
    'targetType',
    'targetId',
    'scopeOrgUnitId',
    'result',
    'source',
    'before',
    'after',
    'reason',
    'requestId',
    'createdAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    actorType: { type: 'string', enum: ['USER', 'SYSTEM'] },
    actorUserId: { type: 'string', format: 'uuid', nullable: true },
    actorLabel: { type: 'string', nullable: true, example: 'system.file-cleanup' },
    actorName: { type: 'string', nullable: true },
    action: { type: 'string', example: 'student.profile.transfer' },
    targetType: { type: 'string', example: 'STUDENT_PROFILE' },
    targetId: { type: 'string', nullable: true },
    scopeOrgUnitId: { type: 'string', format: 'uuid', nullable: true },
    result: { type: 'string', enum: ['SUCCESS', 'FAILURE'] },
    source: { type: 'string', enum: ['WEB', 'IMPORT', 'SYSTEM'] },
    before: { type: 'object', nullable: true, additionalProperties: true },
    after: { type: 'object', nullable: true, additionalProperties: true },
    reason: { type: 'string', nullable: true },
    requestId: { type: 'string', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
  },
}

/**
 * 审计日志查询
 *
 * 只读：不提供创建、修改、删除接口。
 * 写入只能通过 AuditService.record()，由业务事务决定成败。
 */
@ApiTags('审计日志')
@ApiBearerAuth('access-token')
@Controller('audit-logs')
@UseGuards(AccessTokenGuard, PermissionsGuard)
@RequirePermissions(PermissionCode.AUDIT_LOG_READ)
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  @ApiOperation({
    summary: '分页查询授权范围内的审计日志（只读）',
    description:
      '按组织数据范围过滤：只有 scopeOrgUnitId 落在授权范围内的记录可见；' +
      '查询条件只能收窄范围。before/after 为写入时经过安全校验的最小快照。',
  })
  @ApiPaginatedSuccessResponse({
    description: '查询成功',
    itemSchema: auditLogItemSchema,
  })
  @ApiErrorResponse({
    status: 400,
    code: 40001,
    message: '请求参数校验失败',
    dataSchema: validationIssuesSchema,
  })
  @ApiErrorResponse({ status: 401, code: 40101, message: '未登录或登录状态已失效' })
  @ApiErrorResponse({ status: 403, code: 40300, message: '没有查询该组织范围审计日志的权限' })
  list(
    @CurrentUser() authUser: AuthUserContext,
    @Query({ schema: auditLogListQuerySchema }) query: AuditLogListQuery,
  ) {
    return this.auditLogService.list(authUser.userId, query)
  }
}
