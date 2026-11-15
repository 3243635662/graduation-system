import { Module, forwardRef } from '@nestjs/common'

import { ProfilesModule } from '../../profiles/profiles.module.js'
import { OrganizationModule } from '../organizations/organization.module.js'
import { OrganizationScopeService } from './organization-scope.service.js'
import { PermissionService } from './permission.service.js'
import { PermissionsGuard } from './permissions.guard.js'

/**
 * 授权内核
 *
 * 只提供能力，不注册 Controller。
 * 需要权限校验的模块导入本模块后，在 Controller 上使用
 * `@UseGuards(AccessTokenGuard, PermissionsGuard)` + `@RequirePermissions(...)`。
 */
@Module({
  imports: [forwardRef(() => OrganizationModule), forwardRef(() => ProfilesModule)],
  providers: [PermissionService, OrganizationScopeService, PermissionsGuard],
  exports: [PermissionService, OrganizationScopeService, PermissionsGuard],
})
export class AuthorizationModule {}
