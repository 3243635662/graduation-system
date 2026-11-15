import { PermissionCode } from '@graduation/shared'
import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger'
import type { SchemaObject } from '@nestjs/swagger'

import { ApiErrorResponse } from '../../../common/decorators/api-error-response.decorator.js'
import { ApiSuccessResponse } from '../../../common/decorators/api-success-response.decorator.js'
import { validationIssuesSchema } from '../../../common/openapi/validation-issues.schema.js'
import { idParamSchema, type IdParam } from '../../../common/schemas/id-param.schema.js'
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js'
import { AccessTokenGuard } from '../../auth/guards/access-token.guard.js'
import type { AuthUserContext } from '../../auth/types/auth-user.type.js'
import { PermissionsGuard } from '../authorization/permissions.guard.js'
import { RequirePermissions } from '../authorization/require-permissions.decorator.js'
import {
  assignRoleSchema,
  userAssignmentsQuerySchema,
  type AssignRoleBody,
  type UserAssignmentsQuery,
} from './role-assignment.schema.js'
import { RoleAssignmentsService } from './role-assignments.service.js'

const roleAssignmentSchema: SchemaObject = {
  type: 'object',
  required: [
    'id',
    'userId',
    'roleCode',
    'roleName',
    'scopeOrgUnitId',
    'validFrom',
    'validUntil',
    'revokedAt',
    'isEffective',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    userId: { type: 'string', format: 'uuid' },
    roleCode: { type: 'string', example: 'CLASS_COORDINATOR' },
    roleName: { type: 'string', example: '班级事务协管员' },
    scopeOrgUnitId: { type: 'string', format: 'uuid', nullable: true },
    scopeOrgUnitName: { type: 'string', nullable: true },
    scopeOrgUnitType: {
      type: 'string',
      nullable: true,
      enum: ['SCHOOL', 'DEPARTMENT', 'MAJOR', 'CLASS'],
    },
    validFrom: { type: 'string', format: 'date-time' },
    validUntil: { type: 'string', format: 'date-time', nullable: true },
    revokedAt: { type: 'string', format: 'date-time', nullable: true },
    assignedById: { type: 'string', format: 'uuid', nullable: true },
    revokedById: { type: 'string', format: 'uuid', nullable: true },
    revocationReason: {
      type: 'string',
      nullable: true,
      enum: ['MANUAL', 'QUALIFICATION_LOST'],
    },
    isEffective: { type: 'boolean' },
  },
}

const assignableRoleSchema: SchemaObject = {
  type: 'object',
  required: ['code', 'name', 'dataScope', 'scopeType', 'requiresSchoolLevel'],
  properties: {
    code: { type: 'string', example: 'CLASS_COORDINATOR' },
    name: { type: 'string', example: '班级事务协管员' },
    dataScope: { type: 'string', example: 'CLASS' },
    scopeType: { type: 'string', nullable: true, example: 'CLASS' },
    requiresSchoolLevel: { type: 'boolean' },
  },
}

/**
 * 角色分配接口
 *
 * 这是最容易产生提权的入口，三层保护缺一不可：
 * 1. PermissionsGuard：是否拥有 read / assign / revoke 权限；
 * 2. RoleAssignmentsService：角色分配矩阵 + 目标组织类型 + 组织范围；
 * 3. 事务内重复检查 + 软撤销 + 菜单缓存失效。
 *
 * 客户端传入的 userId / roleCode / scopeOrgUnitId 全部会被后端重新校验，
 * 不存在「改一个 ID 就能给自己加角色」的路径。
 */
@ApiTags('RBAC - 角色分配')
@ApiBearerAuth('access-token')
@Controller('role-assignments')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class RoleAssignmentsController {
  constructor(private readonly service: RoleAssignmentsService) {}

  @Get('assignable-roles')
  @RequirePermissions(PermissionCode.ROLE_ASSIGNMENT_READ)
  @ApiOperation({
    summary: '查询当前用户可分配的角色',
    description: '按调用者实际拥有的分配权限与角色矩阵计算，多于矩阵的操作会被服务层拒绝。',
  })
  @ApiSuccessResponse({
    description: '获取可分配角色成功',
    dataSchema: { type: 'array', items: assignableRoleSchema },
  })
  @ApiErrorResponse({ status: 401, code: 40101, message: '未登录或登录状态已失效' })
  @ApiErrorResponse({ status: 403, code: 40300, message: '没有角色分配权限' })
  listAssignableRoles(@CurrentUser() authUser: AuthUserContext) {
    return this.service.listAssignableRoles(authUser.userId)
  }

  @Get('users/:id')
  @RequirePermissions(PermissionCode.ROLE_ASSIGNMENT_READ)
  @ApiOperation({
    summary: '查询指定用户的角色分配',
    description:
      '默认只返回未撤销的分配；结果会按调用者的角色矩阵与组织范围过滤，超出范围的分配不会出现在响应中。',
  })
  @ApiParam({
    name: 'id',
    description: '目标用户 ID（UUID）',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiSuccessResponse({
    description: '获取角色分配成功',
    dataSchema: { type: 'array', items: roleAssignmentSchema },
  })
  @ApiErrorResponse({ status: 401, code: 40101, message: '未登录或登录状态已失效' })
  @ApiErrorResponse({ status: 403, code: 40300, message: '没有角色分配权限' })
  @ApiErrorResponse({ status: 404, code: 40400, message: '用户不存在' })
  listForUser(
    @CurrentUser() authUser: AuthUserContext,
    @Param({ schema: idParamSchema }) params: IdParam,
    @Query({ schema: userAssignmentsQuerySchema }) query: UserAssignmentsQuery,
  ) {
    return this.service.listForUser(authUser.userId, params.id, query.includeRevoked === 'true')
  }

  @Post()
  @RequirePermissions(PermissionCode.ROLE_ASSIGNMENT_ASSIGN)
  @ApiOperation({
    summary: '分配角色',
    description:
      '角色必须绑定与其类型匹配的组织节点；不绑定组织的角色（平台超管/教师/学生）只有学校级管理员可以分配。',
  })
  @ApiSuccessResponse({
    status: 201,
    description: '分配角色成功',
    dataSchema: roleAssignmentSchema,
  })
  @ApiErrorResponse({
    status: 400,
    code: 40001,
    message: '请求参数校验失败',
    dataSchema: validationIssuesSchema,
  })
  @ApiErrorResponse({ status: 403, code: 40300, message: '没有执行该操作的权限' })
  @ApiErrorResponse({ status: 404, code: 40400, message: '用户或组织节点不存在' })
  @ApiErrorResponse({ status: 409, code: 40900, message: '该用户在此范围内已拥有该角色的有效分配' })
  assign(
    @CurrentUser() authUser: AuthUserContext,
    @Body({ schema: assignRoleSchema }) body: AssignRoleBody,
  ) {
    return this.service.assign(authUser.userId, body)
  }

  @Delete(':id')
  @RequirePermissions(PermissionCode.ROLE_ASSIGNMENT_REVOKE)
  @ApiOperation({
    summary: '撤销角色分配（软撤销）',
    description: '只写入 revokedAt / revokedById，保留完整历史记录，不会物理删除。',
  })
  @ApiParam({
    name: 'id',
    description: '角色分配记录 ID（UUID）',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiSuccessResponse({ description: '撤销成功', dataSchema: roleAssignmentSchema })
  @ApiErrorResponse({ status: 401, code: 40101, message: '未登录或登录状态已失效' })
  @ApiErrorResponse({ status: 403, code: 40300, message: '不允许撤销该角色分配' })
  @ApiErrorResponse({ status: 404, code: 40400, message: '角色分配记录不存在' })
  @ApiErrorResponse({ status: 409, code: 40900, message: '该角色分配已被撤销' })
  revoke(
    @CurrentUser() authUser: AuthUserContext,
    @Param({ schema: idParamSchema }) params: IdParam,
  ) {
    return this.service.revoke(authUser.userId, params.id)
  }
}
