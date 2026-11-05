import { Module } from '@nestjs/common'

import { RolesModule } from './modules/rbac/roles/roles.module.js'
import { PrismaModule } from './prisma/prisma.module.js'

@Module({
  imports: [PrismaModule, RolesModule],
})
export class AppModule {}
