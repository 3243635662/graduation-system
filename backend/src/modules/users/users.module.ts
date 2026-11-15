import { Module } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module.js'
import { ProfilesModule } from '../profiles/profiles.module.js'
import { AuthorizationModule } from '../rbac/authorization/authorization.module.js'
import { OrganizationModule } from '../rbac/organizations/organization.module.js'
import { UsersController } from './users.controller.js'
import { UsersService } from './users.service.js'

/**
 * 用户账号模块
 *
 * 只提供只读查询；账号创建、禁用、删除仍由后续阶段单独设计。
 */
@Module({
  imports: [AuthModule, AuthorizationModule, OrganizationModule, ProfilesModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
