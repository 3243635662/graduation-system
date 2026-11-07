import { Module } from '@nestjs/common'

import { AuthController } from './auth.controller.js'
import { AuthService } from './auth.service.js'
import { AccessTokenGuard } from './guards/access-token.guard.js'
import { OriginGuard } from './guards/origin.guard.js'
import { TokenService } from './services/token.service.js'

@Module({
  controllers: [AuthController],
  providers: [AuthService, TokenService, AccessTokenGuard, OriginGuard],
  exports: [AuthService, TokenService, AccessTokenGuard],
})
export class AuthModule {}
