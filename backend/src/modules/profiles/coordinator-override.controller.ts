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
  coordinatorOverrideListQuerySchema,
  type CoordinatorOverrideListQuery,
} from './coordinator-management.schema.js'
import { CoordinatorOverrideService } from './coordinator-override.service.js'
import {
  createCoordinatorOverrideSchema,
  type CreateCoordinatorOverrideBody,
} from './coordinator.schema.js'

/** 协管员资格特殊覆盖（仅 SCHOOL_ADMIN 权限矩阵可命中） */
@ApiTags('协管员 - 特殊覆盖')
@ApiBearerAuth('access-token')
@Controller('coordinator-overrides')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class CoordinatorOverrideController {
  constructor(
    private readonly service: CoordinatorOverrideService,
    private readonly scopeService: OrganizationScopeService,
  ) {}

  @Get()
  @RequirePermissions(PermissionCode.COORDINATOR_OVERRIDE_READ)
  @ApiOperation({ summary: '分页查询授权学校范围内的特殊覆盖历史' })
  @ApiSuccessResponse({ description: '查询成功', dataSchema: { type: 'object' } })
  @ApiErrorResponse({ status: 403, code: 40300, message: '没有访问特殊覆盖授权的权限' })
  async list(
    @CurrentUser() authUser: AuthUserContext,
    @Query({ schema: coordinatorOverrideListQuerySchema })
    query: CoordinatorOverrideListQuery,
  ) {
    const scope = await this.scopeService.resolve(
      authUser.userId,
      PermissionCode.COORDINATOR_OVERRIDE_READ,
    )

    if (scope.kind !== 'SUBTREE') {
      throw new ForbiddenException({
        code: 40300,
        data: null,
        message: '没有可用的特殊覆盖授权范围',
      })
    }

    if (query.classId) {
      await this.scopeService.assertOrgUnitAccess(
        authUser.userId,
        PermissionCode.COORDINATOR_OVERRIDE_READ,
        query.classId,
      )

      if (!scope.orgUnitIds.includes(query.classId)) {
        throw new ForbiddenException({
          code: 40300,
          data: null,
          message: '目标班级不在授权范围内',
        })
      }
    }

    return this.service.listPaged({
      classIds: query.classId ? [query.classId] : scope.orgUnitIds,
      userId: query.userId,
      classId: query.classId,
      status: query.status,
      page: query.page,
      pageSize: query.pageSize,
    })
  }

  @Post()
  @RequirePermissions(PermissionCode.COORDINATOR_OVERRIDE_GRANT)
  @ApiOperation({
    summary: '学校管理员创建协管员资格特殊覆盖',
    description: '必须填写原因；覆盖授权与 CLASS_COORDINATOR 角色在同一事务中创建。',
  })
  @ApiSuccessResponse({ status: 201, description: '创建成功', dataSchema: { type: 'object' } })
  @ApiErrorResponse({
    status: 400,
    code: 40001,
    message: '请求参数校验失败',
    dataSchema: validationIssuesSchema,
  })
  @ApiErrorResponse({ status: 403, code: 40300, message: '只有学校管理员可以授予特殊覆盖' })
  @ApiErrorResponse({ status: 409, code: 40900, message: '该时间段内已存在相同的特殊覆盖授权' })
  async create(
    @CurrentUser() authUser: AuthUserContext,
    @Body({ schema: createCoordinatorOverrideSchema }) body: CreateCoordinatorOverrideBody,
  ) {
    await this.scopeService.assertOrgUnitAccess(
      authUser.userId,
      PermissionCode.COORDINATOR_OVERRIDE_GRANT,
      body.classId,
    )

    return this.service.create(
      {
        userId: body.userId,
        classId: body.classId,
        reason: body.reason,
        validUntil: body.validUntil ? new Date(body.validUntil) : null,
      },
      authUser.userId,
    )
  }

  @Post(':id/revoke')
  @RequirePermissions(PermissionCode.COORDINATOR_OVERRIDE_REVOKE)
  @ApiOperation({ summary: '学校管理员撤销特殊覆盖授权并重算资格' })
  @ApiSuccessResponse({ description: '撤销成功', dataSchema: { type: 'object' } })
  @ApiErrorResponse({ status: 403, code: 40300, message: '只有学校管理员可以撤销特殊覆盖' })
  async revoke(
    @CurrentUser() authUser: AuthUserContext,
    @Param({ schema: idParamSchema }) params: IdParam,
  ) {
    const override = await this.service.findById(params.id)

    await this.scopeService.assertOrgUnitAccess(
      authUser.userId,
      PermissionCode.COORDINATOR_OVERRIDE_REVOKE,
      override.classId,
    )

    return this.service.revoke(params.id, authUser.userId)
  }
}
