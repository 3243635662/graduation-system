import { Controller, Get, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'

import { CurrentUser } from '../auth/decorators/current-user.decorator.js'
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js'
import type { AuthUserContext } from '../auth/types/auth-user.type.js'
import { MyClassesService } from './my-classes.service.js'

@ApiTags('个人工作台')
@ApiBearerAuth('access-token')
@Controller('my-classes')
@UseGuards(AccessTokenGuard)
export class MyClassesController {
  constructor(private readonly service: MyClassesService) {}

  @Get()
  @ApiOperation({ summary: '查询当前用户有效的辅导员与协管班级职责' })
  list(@CurrentUser() authUser: AuthUserContext) {
    return this.service.listForUser(authUser.userId)
  }

  @Get('teacher-duties')
  @ApiOperation({ summary: '查询当前教师有效的班级职责' })
  listTeacherDuties(@CurrentUser() authUser: AuthUserContext) {
    return this.service.listTeacherDutiesForUser(authUser.userId)
  }
}
