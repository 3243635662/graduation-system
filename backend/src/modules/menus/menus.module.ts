import { Module, forwardRef } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module.js'
import { AuthorizationModule } from '../rbac/authorization/authorization.module.js'
import { OrganizationModule } from '../rbac/organizations/organization.module.js'
import { MenuCacheInvalidatorService } from './menu-cache-invalidator.service.js'
import { MENU_CACHE_CONFIG, loadMenuCacheConfig } from './menu-cache.config.js'
import { MenuCacheService } from './menu-cache.service.js'
import { MenusController } from './menus.controller.js'
import { MenusService } from './menus.service.js'

/**
 * 菜单模块
 *
 * - PrismaService / RedisService 来自全局模块，无需重复导入
 * - AuthModule 提供 AccessTokenGuard
 * - MenuCacheInvalidatorService 导出给后续菜单/角色/用户角色写入服务复用
 */
@Module({
  imports: [AuthModule, AuthorizationModule, forwardRef(() => OrganizationModule)],
  controllers: [MenusController],
  providers: [
    { provide: MENU_CACHE_CONFIG, useFactory: () => loadMenuCacheConfig() },
    MenuCacheService,
    MenuCacheInvalidatorService,
    MenusService,
  ],
  exports: [MenusService, MenuCacheService, MenuCacheInvalidatorService],
})
export class MenusModule {}
