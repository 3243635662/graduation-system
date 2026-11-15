import { Module } from '@nestjs/common'

import { RedisModule } from './common/redis/redis.module.js'
import { AuthModule } from './modules/auth/auth.module.js'
import { MenusModule } from './modules/menus/menus.module.js'
import { ProfilesModule } from './modules/profiles/profiles.module.js'
import { RoleAssignmentsModule } from './modules/rbac/assignments/role-assignments.module.js'
import { OrganizationModule } from './modules/rbac/organizations/organization.module.js'
import { RolesModule } from './modules/rbac/roles/roles.module.js'
import { UsersModule } from './modules/users/users.module.js'
import { PrismaModule } from './prisma/prisma.module.js'

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    RolesModule,
    OrganizationModule,
    RoleAssignmentsModule,
    ProfilesModule,
    UsersModule,
    AuthModule,
    MenusModule,
  ],
})
export class AppModule {}
