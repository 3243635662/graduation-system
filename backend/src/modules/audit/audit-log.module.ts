import { Module } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module.js'
import { AuthorizationModule } from '../rbac/authorization/authorization.module.js'
import { AuditLogController } from './audit-log.controller.js'
import { AuditLogService } from './audit-log.service.js'

/**
 * 审计日志查询模块
 *
 * 只注册只读接口；写入口仍然只有 AuditService.record()。
 */
@Module({
  imports: [AuthModule, AuthorizationModule],
  controllers: [AuditLogController],
  providers: [AuditLogService],
})
export class AuditLogModule {}
