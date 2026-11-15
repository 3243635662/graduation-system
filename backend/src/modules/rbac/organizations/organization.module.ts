import { Module, forwardRef } from '@nestjs/common'

import { AuthModule } from '../../auth/auth.module.js'
import { MenusModule } from '../../menus/menus.module.js'
import { AuthorizationModule } from '../authorization/authorization.module.js'
import { OrganizationController } from './organization.controller.js'
import { OrganizationService } from './organization.service.js'

/**
 * 组织架构模块
 *
 * 与 AuthorizationModule 互相引用：本模块的接口需要权限守卫，
 * 授权内核又需要组织服务来解析子树范围，因此使用 forwardRef 解开循环。
 */
@Module({
  imports: [AuthModule, forwardRef(() => AuthorizationModule), forwardRef(() => MenusModule)],
  controllers: [OrganizationController],
  providers: [OrganizationService],
  exports: [OrganizationService],
})
export class OrganizationModule {}
