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
  counselorListQuerySchema,
  type CounselorListQuery,
} from './coordinator-management.schema.js'
import {
  createCounselorAssignmentSchema,
  type CreateCounselorAssignmentBody,
} from './coordinator.schema.js'
import { CounselorClassAssignmentService } from './counselor-class-assignment.service.js'

/** 辅导员班级分配管理（不要求 TeacherProfile） */
@ApiTags('班级职责 - 辅导员')
@ApiBearerAuth('access-token')
@Controller('counselor-class-assignments')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class CounselorClassAssignmentController {
  constructor(
    private readonly service: CounselorClassAssignmentService,
    private readonly scopeService: OrganizationScopeService,
  ) {}

  @Get()
  @RequirePermissions(PermissionCode.COUNSELOR_READ)
  @ApiOperation({ summary: '分页查询授权班级范围内的辅导员分配' })
  @ApiSuccessResponse({ description: '查询成功', dataSchema: { type: 'object' } })
  @ApiErrorResponse({ status: 403, code: 40300, message: '没有访问该班级辅导员分配的权限' })
  async list(
    @CurrentUser() authUser: AuthUserContext,
    @Query({ schema: counselorListQuerySchema }) query: CounselorListQuery,
  ) {
    const classIds = await this.resolveClassIds(
      authUser.userId,
      PermissionCode.COUNSELOR_READ,
      query.classId,
    )

    return this.service.listPaged({
      classIds,
      userId: query.userId,
      classId: query.classId,
      status: query.status,
      page: query.page,
      pageSize: query.pageSize,
    })
  }

  @Post()
  @RequirePermissions(PermissionCode.COUNSELOR_ASSIGN)
  @ApiOperation({ summary: '创建辅导员分配（班级行锁 + 时间重叠检查）' })
  @ApiSuccessResponse({ status: 201, description: '创建成功', dataSchema: { type: 'object' } })
  @ApiErrorResponse({
    status: 400,
    code: 40001,
    message: '用户不可用、班级无效或时间区间非法',
    dataSchema: validationIssuesSchema,
  })
  @ApiErrorResponse({ status: 403, code: 40300, message: '没有维护该班级辅导员分配的权限' })
  @ApiErrorResponse({ status: 409, code: 40900, message: '该时间段内已存在相同的辅导员分配' })
  async create(
    @CurrentUser() authUser: AuthUserContext,
    @Body({ schema: createCounselorAssignmentSchema }) body: CreateCounselorAssignmentBody,
  ) {
    await this.scopeService.assertOrgUnitAccess(
      authUser.userId,
      PermissionCode.COUNSELOR_ASSIGN,
      body.classId,
    )

    return this.service.assign(
      {
        userId: body.userId,
        classId: body.classId,
        validFrom: body.validFrom ? new Date(body.validFrom) : undefined,
        validUntil: body.validUntil ? new Date(body.validUntil) : null,
      },
      authUser.userId,
    )
  }

  @Post(':id/revoke')
  @RequirePermissions(PermissionCode.COUNSELOR_REVOKE)
  @ApiOperation({ summary: '撤销辅导员分配并重算协管员资格' })
  @ApiSuccessResponse({ description: '撤销成功', dataSchema: { type: 'object' } })
  @ApiErrorResponse({ status: 403, code: 40300, message: '没有撤销该辅导员分配的权限' })
  async revoke(
    @CurrentUser() authUser: AuthUserContext,
    @Param({ schema: idParamSchema }) params: IdParam,
  ) {
    const assignment = await this.service.findById(params.id)

    await this.scopeService.assertOrgUnitAccess(
      authUser.userId,
      PermissionCode.COUNSELOR_REVOKE,
      assignment.classId,
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
        message: '没有可用的辅导员管理范围',
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
