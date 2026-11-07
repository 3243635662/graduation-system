import { Module } from '@nestjs/common'

import { AuthModule } from './modules/auth/auth.module.js'
import { RolesModule } from './modules/rbac/roles/roles.module.js'
import { PrismaModule } from './prisma/prisma.module.js'

@Module({
  imports: [PrismaModule, RolesModule, AuthModule],
})
export class AppModule {}
