import { PermissionCode } from '@graduation/shared'
import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common'
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
import { assignRoleSchema, type AssignRoleBody } from './role-assignment.schema.js'
import { RoleAssignmentsService } from './role-assignments.service.js'

const roleAssignmentSchema: SchemaObject = {
  type: 'object',
  required: [
    'id',
    'userId',
    'roleCode',
    'roleName',
    'scopeOrgUnitId',
    'scopeKey',
    'validFrom',
    'validUntil',
    'isEffective',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    userId: { type: 'string', format: 'uuid' },
    roleCode: { type: 'string', example: 'CLASS_COORDINATOR' },
    roleName: { type: 'string', example: '班级事务协管员' },
    scopeOrgUnitId: { type: 'string', format: 'uuid', nullable: true },
    scopeKey: {
      type: 'string',
      description: '规范化范围键：平台/非组织角色为 GLOBAL，组织角色为组织节点 ID',
      example: 'GLOBAL',
    },
    scopeOrgUnitName: { type: 'string', nullable: true },
    scopeOrgUnitType: {
      type: 'string',
      nullable: true,
      enum: ['SCHOOL', 'DEPARTMENT', 'MAJOR', 'CLASS'],
    },
    validFrom: { type: 'string', format: 'date-time' },
    validUntil: { type: 'string', format: 'date-time', nullable: true },
    assignedById: { type: 'string', format: 'uuid', nullable: true },
    isEffective: { type: 'boolean' },
  },
}

const roleAssignmentHistorySchema: SchemaObject = {
  type: 'object',
  required: [
    'id',
    'userRoleId',
    'userId',
    'roleId',
    'roleCode',
    'roleName',
    'scopeKey',
    'validFrom',
    'revokedAt',
    'revocationReason',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    userRoleId: {
      type: 'string',
      format: 'uuid',
      description: '被撤销的那条当前授权行 ID',
    },
    userId: { type: 'string', format: 'uuid' },
    roleId: { type: 'string', format: 'uuid' },
    roleCode: { type: 'string', example: 'CLASS_COORDINATOR' },
    roleName: { type: 'string', example: '班级事务协管员' },
    scopeOrgUnitId: { type: 'string', format: 'uuid', nullable: true },
    scopeKey: { type: 'string', example: 'GLOBAL' },
    scopeOrgUnitName: { type: 'string', nullable: true },
    scopeOrgUnitType: {
      type: 'string',
      nullable: true,
      enum: ['SCHOOL', 'DEPARTMENT', 'MAJOR', 'CLASS'],
    },
    assignedById: { type: 'string', format: 'uuid', nullable: true },
    validFrom: { type: 'string', format: 'date-time' },
    validUntil: { type: 'string', format: 'date-time', nullable: true },
    revokedAt: { type: 'string', format: 'date-time' },
    revokedById: { type: 'string', format: 'uuid', nullable: true },
    revokedByName: {
      type: 'string',
      nullable: true,
      description: '撤销人真名；撤销账号被删除时为 null',
      example: '李老师',
    },
    revocationReason: {
      type: 'string',
      enum: ['MANUAL', 'QUALIFICATION_LOST'],
      example: 'MANUAL',
    },
    note: { type: 'string', nullable: true },
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
 * 3. 唯一键约束兜住重复分配 + 撤销时「先写不可变历史再删除」+ 菜单缓存失效。
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
    summary: '查询指定用户当前的角色分配',
    description:
      '只返回仍然存在的授权（撤销即从当前授权表删除）。结果会按调用者的角色矩阵与组织范围过滤，超出范围的分配不会出现在响应中。已撤销的历史请使用 GET /role-assignments/users/{id}/history。',
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
  ) {
    return this.service.listForUser(authUser.userId, params.id)
  }

  @Get('users/:id/history')
  @RequirePermissions(PermissionCode.ROLE_ASSIGNMENT_READ)
  @ApiOperation({
    summary: '查询指定用户的授权历史',
    description:
      '返回该用户已被撤销的授权快照，按撤销时间倒序。历史表只追加不修改，撤销操作会先写入快照再删除当前授权，因此历史可完整回溯。',
  })
  @ApiParam({
    name: 'id',
    description: '目标用户 ID（UUID）',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiSuccessResponse({
    description: '获取授权历史成功',
    dataSchema: { type: 'array', items: roleAssignmentHistorySchema },
  })
  @ApiErrorResponse({ status: 401, code: 40101, message: '未登录或登录状态已失效' })
  @ApiErrorResponse({ status: 403, code: 40300, message: '没有角色分配权限' })
  @ApiErrorResponse({ status: 404, code: 40400, message: '用户不存在' })
  listHistory(
    @CurrentUser() authUser: AuthUserContext,
    @Param({ schema: idParamSchema }) params: IdParam,
  ) {
    return this.service.listHistory(authUser.userId, params.id)
  }

  @Post()
  @RequirePermissions(PermissionCode.ROLE_ASSIGNMENT_ASSIGN)
  @ApiOperation({
    summary: '分配角色',
    description:
      '角色必须绑定与其类型匹配的组织节点；不绑定组织的角色（平台超管/教师/学生）只有学校级管理员可以分配。同一用户 + 角色 + 组织范围的重复分配会返回 409。',
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
  @ApiErrorResponse({
    status: 409,
    code: 40900,
    message: '该用户在此范围内已存在该角色的授权，请先撤销原授权后再重新分配',
  })
  assign(
    @CurrentUser() authUser: AuthUserContext,
    @Body({ schema: assignRoleSchema }) body: AssignRoleBody,
  ) {
    return this.service.assign(authUser.userId, body)
  }

  @Delete(':id')
  @RequirePermissions(PermissionCode.ROLE_ASSIGNMENT_REVOKE)
  @ApiOperation({
    summary: '撤销角色分配',
    description:
      '写入不可变历史（user_role_history）后删除当前授权行，撤销后立即失去对应权限与菜单入口；返回被撤销的当前授权行 ID。',
  })
  @ApiParam({
    name: 'id',
    description: '当前角色授权记录 ID（UUID）',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiSuccessResponse({
    description: '撤销成功，返回被撤销的授权记录 ID',
    dataSchema: { type: 'string', format: 'uuid' },
  })
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
