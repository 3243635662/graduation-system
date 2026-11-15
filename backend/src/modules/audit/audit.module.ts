import { Module } from '@nestjs/common'

import { AuditService } from './audit.service.js'

/**
 * 审计基础设施
 *
 * 只提供唯一写入口，不注册 Controller；
 * 查询接口在 AuditLogModule，避免业务模块为了写审计而引入授权/HTTP 依赖。
 */
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
