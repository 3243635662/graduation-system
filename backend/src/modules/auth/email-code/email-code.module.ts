import { Module } from '@nestjs/common'

import { EmailModule } from '../email/email.module.js'
import { EmailCodeService } from './email-code.service.js'

/**
 * 邮箱验证码模块
 *
 * 依赖：
 * - RedisModule（全局）：验证码存储、冷却与限流
 * - EmailModule：SMTP 发信
 * - PrismaModule（全局）：判断邮箱是否已注册
 */
@Module({
  imports: [EmailModule],
  providers: [EmailCodeService],
  exports: [EmailCodeService],
})
export class EmailCodeModule {}
