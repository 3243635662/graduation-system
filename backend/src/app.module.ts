import { Module } from '@nestjs/common'

import { RedisModule } from './common/redis/redis.module.js'
import { AuthModule } from './modules/auth/auth.module.js'
import { RolesModule } from './modules/rbac/roles/roles.module.js'
import { PrismaModule } from './prisma/prisma.module.js'

@Module({
  imports: [PrismaModule, RedisModule, RolesModule, AuthModule],
})
export class AppModule {}
