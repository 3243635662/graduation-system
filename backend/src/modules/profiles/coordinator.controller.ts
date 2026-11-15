import { PermissionCode } from '@graduation/shared'
import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common'
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
import { CoordinatorEligibilityService } from './coordinator-eligibility.service.js'
import { CoordinatorOverrideService } from './coordinator-override.service.js'
import {
  coordinatorClassQuerySchema,
  coordinatorEligibilityQuerySchema,
  coordinatorOverrideQuerySchema,
  createCoordinatorOverrideSchema,
  createCounselorAssignmentSchema,
  createTeacherDutySchema,
  type CoordinatorClassQuery,
  type CoordinatorEligibilityQuery,
  type CoordinatorOverrideQuery,
  type CreateCoordinatorOverrideBody,
  type CreateCounselorAssignmentBody,
  type CreateTeacherDutyBody,
} from './coordinator.schema.js'
import { CounselorClassAssignmentService } from './counselor-class-assignment.service.js'
import { TeacherClassDutyService } from './teacher-class-duty.service.js'

/**
 * 协管员资格与班级任职接口
 *
 * 功能权限沿用角色分配权限（read / assign / revoke）；
 * 具体角色模板与组织范围由服务层再次校验。
 */
@ApiTags('RBAC - 协管员资格')
@ApiBearerAuth('access-token')
@Controller('coordinator')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class CoordinatorController {
  constructor(
    private readonly eligibility: CoordinatorEligibilityService,
    private readonly dutyService: TeacherClassDutyService,
    private readonly counselorService: CounselorClassAssignmentService,
    private readonly overrideService: CoordinatorOverrideService,
    private readonly scopeService: OrganizationScopeService,
  ) {}

  @Get('eligibility')
  @RequirePermissions(PermissionCode.ROLE_ASSIGNMENT_READ)
  @ApiOperation({
    summary: '查询用户在指定班级的协管员资格来源',
    description:
      '返回的 bases 只是可被管理员选择的资格条件，不代表自动获得 CLASS_COORDINATOR；' +
      '正式任命仍需调用 /api/role-assignments 显式分配。',
  })
  @ApiSuccessResponse({
    description: '查询成功',
    dataSchema: {
      type: 'object',
      properties: {
        eligible: { type: 'boolean' },
        bases: { type: 'array', items: { type: 'string' } },
        expiresAt: { type: 'string', format: 'date-time', nullable: true },
      },
    },
  })
  @ApiErrorResponse({ status: 401, code: 40101, message: '未登录或登录状态已失效' })
  @ApiErrorResponse({ status: 403, code: 40300, message: '没有访问该组织范围数据的权限' })
  async getEligibility(
    @CurrentUser() authUser: AuthUserContext,
    @Query({ schema: coordinatorEligibilityQuerySchema }) query: CoordinatorEligibilityQuery,
  ) {
    await this.scopeService.assertOrgUnitAccess(
      authUser.userId,
      PermissionCode.ROLE_ASSIGNMENT_READ,
      query.classId,
    )

    return this.eligibility.evaluate(query.userId, query.classId)
  }

  @Post('teacher-duties')
  @RequirePermissions(PermissionCode.CLASS_DUTY_ASSIGN)
  @ApiOperation({ summary: '创建班主任任职（班级行锁 + 时间重叠检查）' })
  @ApiSuccessResponse({ status: 201, description: '创建成功', dataSchema: { type: 'object' } })
  @ApiErrorResponse({
    status: 400,
    code: 40001,
    message: '请求参数校验失败',
    dataSchema: validationIssuesSchema,
  })
  @ApiErrorResponse({ status: 403, code: 40300, message: '没有维护班主任任职的权限' })
  @ApiErrorResponse({ status: 409, code: 40900, message: '该时间段内已存在相同的班主任任职' })
  async createDuty(
    @CurrentUser() authUser: AuthUserContext,
    @Body({ schema: createTeacherDutySchema }) body: CreateTeacherDutyBody,
  ) {
    await this.scopeService.assertOrgUnitAccess(
      authUser.userId,
      PermissionCode.CLASS_DUTY_ASSIGN,
      body.classId,
    )

    return this.dutyService.assign(
      {
        teacherId: body.teacherId,
        classId: body.classId,
        validFrom: body.validFrom ? new Date(body.validFrom) : undefined,
        validUntil: body.validUntil ? new Date(body.validUntil) : null,
      },
      authUser.userId,
    )
  }

  @Get('teacher-duties')
  @RequirePermissions(PermissionCode.CLASS_DUTY_READ)
  @ApiOperation({ summary: '查询班级班主任任职（默认仅有效）' })
  @ApiSuccessResponse({
    description: '查询成功',
    dataSchema: { type: 'array', items: { type: 'object' } },
  })
  async listDuties(
    @CurrentUser() authUser: AuthUserContext,
    @Query({ schema: coordinatorClassQuerySchema }) query: CoordinatorClassQuery,
  ) {
    await this.scopeService.assertOrgUnitAccess(
      authUser.userId,
      PermissionCode.CLASS_DUTY_READ,
      query.classId,
    )

    return this.dutyService.listByClass(query.classId, query.includeRevoked === 'true')
  }

  @Delete('teacher-duties/:id')
  @RequirePermissions(PermissionCode.CLASS_DUTY_REVOKE)
  @ApiOperation({ summary: '撤销班主任任职并重算协管员资格' })
  @ApiSuccessResponse({ description: '撤销成功', dataSchema: { type: 'object' } })
  @ApiErrorResponse({ status: 403, code: 40300, message: '没有撤销班主任任职的权限' })
  @ApiErrorResponse({ status: 404, code: 40400, message: '班主任任职记录不存在' })
  revokeDuty(
    @CurrentUser() authUser: AuthUserContext,
    @Param({ schema: idParamSchema }) params: IdParam,
  ) {
    return this.dutyService.revoke(params.id, authUser.userId)
  }

  @Post('counselors')
  @RequirePermissions(PermissionCode.COUNSELOR_ASSIGN)
  @ApiOperation({ summary: '创建辅导员分配（班级行锁 + 时间重叠检查）' })
  @ApiSuccessResponse({ status: 201, description: '创建成功', dataSchema: { type: 'object' } })
  @ApiErrorResponse({ status: 403, code: 40300, message: '没有维护辅导员分配的权限' })
  @ApiErrorResponse({ status: 409, code: 40900, message: '该时间段内已存在相同的辅导员分配' })
  async createCounselor(
    @CurrentUser() authUser: AuthUserContext,
    @Body({ schema: createCounselorAssignmentSchema }) body: CreateCounselorAssignmentBody,
  ) {
    await this.scopeService.assertOrgUnitAccess(
      authUser.userId,
      PermissionCode.COUNSELOR_ASSIGN,
      body.classId,
    )

    return this.counselorService.assign(
      {
        userId: body.userId,
        classId: body.classId,
        validFrom: body.validFrom ? new Date(body.validFrom) : undefined,
        validUntil: body.validUntil ? new Date(body.validUntil) : null,
      },
      authUser.userId,
    )
  }

  @Get('counselors')
  @RequirePermissions(PermissionCode.COUNSELOR_READ)
  @ApiOperation({ summary: '查询班级辅导员分配（默认仅有效）' })
  @ApiSuccessResponse({
    description: '查询成功',
    dataSchema: { type: 'array', items: { type: 'object' } },
  })
  async listCounselors(
    @CurrentUser() authUser: AuthUserContext,
    @Query({ schema: coordinatorClassQuerySchema }) query: CoordinatorClassQuery,
  ) {
    await this.scopeService.assertOrgUnitAccess(
      authUser.userId,
      PermissionCode.COUNSELOR_READ,
      query.classId,
    )

    return this.counselorService.listByClass(query.classId, query.includeRevoked === 'true')
  }

  @Delete('counselors/:id')
  @RequirePermissions(PermissionCode.COUNSELOR_REVOKE)
  @ApiOperation({ summary: '撤销辅导员分配并重算协管员资格' })
  @ApiSuccessResponse({ description: '撤销成功', dataSchema: { type: 'object' } })
  @ApiErrorResponse({ status: 403, code: 40300, message: '没有撤销辅导员分配的权限' })
  revokeCounselor(
    @CurrentUser() authUser: AuthUserContext,
    @Param({ schema: idParamSchema }) params: IdParam,
  ) {
    return this.counselorService.revoke(params.id, authUser.userId)
  }

  @Post('overrides')
  @RequirePermissions(PermissionCode.COORDINATOR_OVERRIDE_GRANT)
  @ApiOperation({
    summary: '学校管理员创建协管员资格特殊覆盖（必须填写原因）',
    description: '覆盖授权与对应 CLASS_COORDINATOR 角色分配在同一事务中创建。',
  })
  @ApiSuccessResponse({ status: 201, description: '创建成功', dataSchema: { type: 'object' } })
  @ApiErrorResponse({
    status: 400,
    code: 40001,
    message: '请求参数校验失败',
    dataSchema: validationIssuesSchema,
  })
  @ApiErrorResponse({ status: 403, code: 40300, message: '只有学校管理员可以执行特殊覆盖' })
  @ApiErrorResponse({ status: 409, code: 40900, message: '该时间段内已存在相同的特殊覆盖授权' })
  async createOverride(
    @CurrentUser() authUser: AuthUserContext,
    @Body({ schema: createCoordinatorOverrideSchema }) body: CreateCoordinatorOverrideBody,
  ) {
    await this.scopeService.assertOrgUnitAccess(
      authUser.userId,
      PermissionCode.COORDINATOR_OVERRIDE_GRANT,
      body.classId,
    )

    return this.overrideService.create(
      {
        userId: body.userId,
        classId: body.classId,
        reason: body.reason,
        validUntil: body.validUntil ? new Date(body.validUntil) : null,
      },
      authUser.userId,
    )
  }

  @Get('overrides')
  @RequirePermissions(PermissionCode.COORDINATOR_OVERRIDE_READ)
  @ApiOperation({ summary: '查询特殊覆盖授权历史' })
  @ApiSuccessResponse({
    description: '查询成功',
    dataSchema: { type: 'array', items: { type: 'object' } },
  })
  async listOverrides(
    @CurrentUser() authUser: AuthUserContext,
    @Query({ schema: coordinatorOverrideQuerySchema }) query: CoordinatorOverrideQuery,
  ) {
    if (query.classId) {
      await this.scopeService.assertOrgUnitAccess(
        authUser.userId,
        PermissionCode.COORDINATOR_OVERRIDE_READ,
        query.classId,
      )
    }

    return this.overrideService.list({
      userId: query.userId,
      classId: query.classId,
      includeRevoked: query.includeRevoked === 'true',
    })
  }

  @Delete('overrides/:id')
  @RequirePermissions(PermissionCode.COORDINATOR_OVERRIDE_REVOKE)
  @ApiOperation({ summary: '学校管理员撤销特殊覆盖授权' })
  @ApiSuccessResponse({ description: '撤销成功', dataSchema: { type: 'object' } })
  @ApiErrorResponse({ status: 403, code: 40300, message: '只有学校管理员可以撤销特殊覆盖' })
  revokeOverride(
    @CurrentUser() authUser: AuthUserContext,
    @Param({ schema: idParamSchema }) params: IdParam,
  ) {
    return this.overrideService.revoke(params.id, authUser.userId)
  }
}
