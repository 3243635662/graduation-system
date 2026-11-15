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
  // MenusModule 与授权内核存在循环引用（授权需要菜单缓存失效，菜单需要权限守卫），
  // 必须用 forwardRef 延迟解析，否则新增入口模块改变加载顺序时会拿到 undefined
  imports: [
    AuthModule,
    forwardRef(() => AuthorizationModule),
    forwardRef(() => OrganizationModule),
  ],
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
