import { Module } from '@nestjs/common'

import { EmailService } from './email.service.js'

/**
 * 邮件模块
 *
 * 只暴露 EmailService，不提供任何公开的 SMTP 测试接口，
 * 避免被用来向任意邮箱批量发信。
 */
@Module({
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
