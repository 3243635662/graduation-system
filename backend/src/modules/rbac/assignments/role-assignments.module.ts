import { Module } from '@nestjs/common'

import { AuthModule } from '../../auth/auth.module.js'
import { MenusModule } from '../../menus/menus.module.js'
import { ProfilesModule } from '../../profiles/profiles.module.js'
import { AuthorizationModule } from '../authorization/authorization.module.js'
import { OrganizationModule } from '../organizations/organization.module.js'
import { RoleAssignmentsController } from './role-assignments.controller.js'
import { RoleAssignmentsService } from './role-assignments.service.js'

/**
 * 角色分配模块
 *
 * 依赖：
 * - AuthorizationModule：权限解析 + 组织范围 + 守卫
 * - OrganizationModule：目标组织节点类型/状态校验
 * - MenusModule：写操作提交后提升菜单缓存 generation
 */
@Module({
  imports: [AuthModule, AuthorizationModule, OrganizationModule, MenusModule, ProfilesModule],
  controllers: [RoleAssignmentsController],
  providers: [RoleAssignmentsService],
})
export class RoleAssignmentsModule {}
