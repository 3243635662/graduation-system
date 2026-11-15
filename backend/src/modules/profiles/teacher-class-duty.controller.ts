import { PermissionCode } from '@graduation/shared'
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'

import { ApiErrorResponse } from '../../common/decorators/api-error-response.decorator.js'
import { ApiSuccessResponse } from '../../common/decorators/api-success-response.decorator.js'
import { validationIssuesSchema } from '../../common/openapi/validation-issues.schema.js'
import { idParamSchema, type IdParam } from '../../common/schemas/id-param.schema.js'
import { CurrentUser } from '../auth/decorators/current-user.decorator.js'
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js'
import type { AuthUserContext } from '../auth/types/auth-user.type.js'
import { OrganizationScopeService } from '../rbac/authorization/organization-scope.service.js'
import { PermissionsGuard } from '../rbac/authorization/permissions.guard.js'
import { RequirePermissions } from '../rbac/authorization/require-permissions.decorator.js'
import {
  teacherDutyListQuerySchema,
  type TeacherDutyListQuery,
} from './coordinator-management.schema.js'
import { createTeacherDutySchema, type CreateTeacherDutyBody } from './coordinator.schema.js'
import { TeacherClassDutyService } from './teacher-class-duty.service.js'

/** 班主任任职管理（独立任职权限，不复用 UserRole 分配权限） */
@ApiTags('班级职责 - 班主任')
@ApiBearerAuth('access-token')
@Controller('teacher-class-duties')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class TeacherClassDutyController {
  constructor(
    private readonly service: TeacherClassDutyService,
    private readonly scopeService: OrganizationScopeService,
  ) {}

  @Get()
  @RequirePermissions(PermissionCode.CLASS_DUTY_READ)
  @ApiOperation({ summary: '分页查询授权班级范围内的班主任任职' })
  @ApiSuccessResponse({ description: '查询成功', dataSchema: { type: 'object' } })
  @ApiErrorResponse({ status: 403, code: 40300, message: '没有访问该班级任职的权限' })
  async list(
    @CurrentUser() authUser: AuthUserContext,
    @Query({ schema: teacherDutyListQuerySchema }) query: TeacherDutyListQuery,
  ) {
    const classIds = await this.resolveClassIds(
      authUser.userId,
      PermissionCode.CLASS_DUTY_READ,
      query.classId,
    )

    return this.service.listPaged({
      classIds,
      teacherId: query.teacherId,
      classId: query.classId,
      dutyType: query.dutyType,
      status: query.status,
      page: query.page,
      pageSize: query.pageSize,
    })
  }

  @Get(':id')
  @RequirePermissions(PermissionCode.CLASS_DUTY_READ)
  @ApiOperation({ summary: '班主任任职详情' })
  @ApiSuccessResponse({ description: '查询成功', dataSchema: { type: 'object' } })
  @ApiErrorResponse({ status: 403, code: 40300, message: '没有访问该任职的权限' })
  @ApiErrorResponse({ status: 404, code: 40400, message: '班主任任职记录不存在' })
  async findOne(
    @CurrentUser() authUser: AuthUserContext,
    @Param({ schema: idParamSchema }) params: IdParam,
  ) {
    const duty = await this.service.findDetail(params.id)

    await this.scopeService.assertOrgUnitAccess(
      authUser.userId,
      PermissionCode.CLASS_DUTY_READ,
      duty.classId,
    )

    return duty
  }

  @Post()
  @RequirePermissions(PermissionCode.CLASS_DUTY_ASSIGN)
  @ApiOperation({ summary: '创建班主任任职（班级行锁 + 时间重叠检查）' })
  @ApiSuccessResponse({ status: 201, description: '创建成功', dataSchema: { type: 'object' } })
  @ApiErrorResponse({
    status: 400,
    code: 40001,
    message: '教师不在职、班级无效或时间区间非法',
    dataSchema: validationIssuesSchema,
  })
  @ApiErrorResponse({ status: 403, code: 40300, message: '没有维护该班级任职的权限' })
  @ApiErrorResponse({ status: 409, code: 40900, message: '该时间段内已存在相同的班主任任职' })
  async create(
    @CurrentUser() authUser: AuthUserContext,
    @Body({ schema: createTeacherDutySchema }) body: CreateTeacherDutyBody,
  ) {
    await this.scopeService.assertOrgUnitAccess(
      authUser.userId,
      PermissionCode.CLASS_DUTY_ASSIGN,
      body.classId,
    )

    return this.service.assign(
      {
        teacherId: body.teacherId,
        classId: body.classId,
        validFrom: body.validFrom ? new Date(body.validFrom) : undefined,
        validUntil: body.validUntil ? new Date(body.validUntil) : null,
      },
      authUser.userId,
    )
  }

  @Post(':id/revoke')
  @RequirePermissions(PermissionCode.CLASS_DUTY_REVOKE)
  @ApiOperation({ summary: '撤销班主任任职并重算协管员资格' })
  @ApiSuccessResponse({ description: '撤销成功', dataSchema: { type: 'object' } })
  @ApiErrorResponse({ status: 403, code: 40300, message: '没有撤销该任职的权限' })
  async revoke(
    @CurrentUser() authUser: AuthUserContext,
    @Param({ schema: idParamSchema }) params: IdParam,
  ) {
    const duty = await this.service.findDetail(params.id)

    await this.scopeService.assertOrgUnitAccess(
      authUser.userId,
      PermissionCode.CLASS_DUTY_REVOKE,
      duty.classId,
    )

    return this.service.revoke(params.id, authUser.userId)
  }

  private async resolveClassIds(
    actorId: string,
    permissionCode: PermissionCode,
    requestedClassId?: string,
  ): Promise<string[]> {
    const scope = await this.scopeService.resolve(actorId, permissionCode)

    if (scope.kind !== 'SUBTREE') {
      throw new ForbiddenException({
        code: 40300,
        data: null,
        message: '没有可用的班级任职管理范围',
      })
    }

    if (requestedClassId) {
      await this.scopeService.assertOrgUnitAccess(actorId, permissionCode, requestedClassId)

      if (!scope.orgUnitIds.includes(requestedClassId)) {
        throw new ForbiddenException({
          code: 40300,
          data: null,
          message: '目标班级不在授权范围内',
        })
      }

      return [requestedClassId]
    }

    return scope.orgUnitIds
  }
}
