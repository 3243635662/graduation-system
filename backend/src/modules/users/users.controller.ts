import { PermissionCode } from '@graduation/shared'
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger'
import type { SchemaObject } from '@nestjs/swagger'

import { ApiErrorResponse } from '../../common/decorators/api-error-response.decorator.js'
import { ApiSuccessResponse } from '../../common/decorators/api-success-response.decorator.js'
import { validationIssuesSchema } from '../../common/openapi/validation-issues.schema.js'
import { idParamSchema, type IdParam } from '../../common/schemas/id-param.schema.js'
import { CurrentUser } from '../auth/decorators/current-user.decorator.js'
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js'
import type { AuthUserContext } from '../auth/types/auth-user.type.js'
import { PermissionsGuard } from '../rbac/authorization/permissions.guard.js'
import { RequirePermissions } from '../rbac/authorization/require-permissions.decorator.js'
import { userListQuerySchema, type UserListQuery } from './users.schema.js'
import { UsersService } from './users.service.js'

const roleSummarySchema: SchemaObject = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    code: { type: 'string', example: 'CLASS_COORDINATOR' },
    name: { type: 'string', example: '班级事务协管员' },
    scopeOrgUnitId: { type: 'string', format: 'uuid', nullable: true },
    scopeOrgUnitName: { type: 'string', nullable: true },
    scopeOrgUnitType: { type: 'string', nullable: true },
    validFrom: { type: 'string', format: 'date-time' },
    validUntil: { type: 'string', format: 'date-time', nullable: true },
    isEffective: { type: 'boolean' },
  },
}

const userItemSchema: SchemaObject = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    realName: { type: 'string', description: '真实姓名（User.realName）' },
    email: { type: 'string', format: 'email' },
    status: { type: 'string', enum: ['ACTIVE', 'DISABLED', 'LOCKED'] },
    lastLoginAt: { type: 'string', format: 'date-time', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
    roles: { type: 'array', items: roleSummarySchema },
    studentProfile: {
      type: 'object',
      nullable: true,
      description: '学生档案摘要；未分班（classId 为空）的学生不返回该字段',
      properties: {
        id: { type: 'string', format: 'uuid' },
        studentNo: { type: 'string' },
        name: { type: 'string', description: '取 User.realName' },
        classId: { type: 'string', format: 'uuid', nullable: true },
        className: { type: 'string', nullable: true },
        enrollmentStatus: { type: 'string' },
      },
    },
    teacherProfile: {
      type: 'object',
      nullable: true,
      description: '教师档案摘要；所属组织取工作人员档案的正式组织归属',
      properties: {
        id: { type: 'string', format: 'uuid' },
        teacherNo: { type: 'string' },
        realName: { type: 'string', description: '取 personnelProfile.user.realName' },
        organizationId: { type: 'string', format: 'uuid' },
        organizationName: { type: 'string' },
        organizationType: { type: 'string', enum: ['SCHOOL', 'DEPARTMENT', 'MAJOR', 'CLASS'] },
        status: { type: 'string', enum: ['ACTIVE', 'ON_LEAVE', 'LEFT'] },
      },
    },
  },
}

/**
 * 用户账号查询
 *
 * 只有 user:read 权限 + 组织范围同时满足时才返回账号；
 * 学生/教师档案与角色摘要均独立授权，不会因账号可见而全部暴露。
 */
@ApiTags('用户管理')
@ApiBearerAuth('access-token')
@Controller('users')
@UseGuards(AccessTokenGuard, PermissionsGuard)
@RequirePermissions(PermissionCode.USER_READ)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @ApiOperation({
    summary: '分页查询授权范围内的用户账号',
    description:
      '账号可见性由学生档案班级、工作人员档案正式组织归属、有效管理角色、有效辅导员分配共同决定；' +
      '查询参数只能收窄范围。',
  })
  @ApiSuccessResponse({
    description: '查询成功',
    dataSchema: {
      type: 'object',
      properties: {
        total: { type: 'number' },
        list: { type: 'array', items: userItemSchema },
      },
    },
  })
  @ApiErrorResponse({
    status: 400,
    code: 40001,
    message: '请求参数校验失败',
    dataSchema: validationIssuesSchema,
  })
  @ApiErrorResponse({ status: 401, code: 40101, message: '未登录或登录状态已失效' })
  @ApiErrorResponse({ status: 403, code: 40300, message: '没有访问该组织范围用户的权限' })
  list(
    @CurrentUser() authUser: AuthUserContext,
    @Query({ schema: userListQuerySchema }) query: UserListQuery,
  ) {
    return this.usersService.list(authUser.userId, query)
  }

  @Get(':id')
  @ApiOperation({ summary: '查询授权范围内的用户详情' })
  @ApiParam({
    name: 'id',
    description: '用户 ID（UUID）',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiSuccessResponse({ description: '查询成功', dataSchema: userItemSchema })
  @ApiErrorResponse({ status: 401, code: 40101, message: '未登录或登录状态已失效' })
  @ApiErrorResponse({ status: 403, code: 40300, message: '该用户不在当前访问范围内' })
  findOne(
    @CurrentUser() authUser: AuthUserContext,
    @Param({ schema: idParamSchema }) params: IdParam,
  ) {
    return this.usersService.findOne(authUser.userId, params.id)
  }
}
