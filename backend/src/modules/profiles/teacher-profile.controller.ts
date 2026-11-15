import { PermissionCode } from '@graduation/shared'
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
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
  adjustTeacherDepartmentSchema,
  createTeacherProfileSchema,
  teacherProfileListQuerySchema,
  updateTeacherEmploymentStatusSchema,
  type AdjustTeacherDepartmentBody,
  type CreateTeacherProfileBody,
  type TeacherProfileListQuery,
  type UpdateTeacherEmploymentStatusBody,
} from './teacher-profile.schema.js'
import { TeacherProfileService } from './teacher-profile.service.js'

/**
 * 教师档案管理
 *
 * 查询范围来自 teacher:profile:read 的院系子树；
 * 院系调整与在职状态使用独立权限，避免用 teacher:profile:update 一把抓。
 */
@ApiTags('教师档案')
@ApiBearerAuth('access-token')
@Controller('teacher-profiles')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class TeacherProfileController {
  constructor(
    private readonly service: TeacherProfileService,
    private readonly scopeService: OrganizationScopeService,
  ) {}

  @Get()
  @RequirePermissions(PermissionCode.TEACHER_PROFILE_READ)
  @ApiOperation({ summary: '分页查询授权院系范围内的教师档案' })
  @ApiSuccessResponse({ description: '查询成功', dataSchema: { type: 'object' } })
  @ApiErrorResponse({ status: 401, code: 40101, message: '未登录或登录状态已失效' })
  @ApiErrorResponse({ status: 403, code: 40300, message: '没有访问该院系教师档案的权限' })
  async list(
    @CurrentUser() authUser: AuthUserContext,
    @Query({ schema: teacherProfileListQuerySchema }) query: TeacherProfileListQuery,
  ) {
    const departmentIds = await this.resolveDepartmentIds(
      authUser.userId,
      PermissionCode.TEACHER_PROFILE_READ,
      query.departmentId,
    )

    return this.service.list({
      departmentIds,
      page: query.page,
      pageSize: query.pageSize,
      keyword: query.keyword,
      teacherNo: query.teacherNo,
      name: query.name,
      departmentId: query.departmentId,
      employmentStatus: query.employmentStatus,
    })
  }

  @Get(':id')
  @RequirePermissions(PermissionCode.TEACHER_PROFILE_READ)
  @ApiOperation({ summary: '教师档案详情（含授权范围内的班级职责）' })
  @ApiErrorResponse({ status: 403, code: 40300, message: '没有访问该教师档案的权限' })
  @ApiErrorResponse({ status: 404, code: 40400, message: '教师档案不存在' })
  async findOne(
    @CurrentUser() authUser: AuthUserContext,
    @Param({ schema: idParamSchema }) params: IdParam,
  ) {
    const profile = await this.service.findById(params.id)

    const scope = await this.assertDepartmentAccess(
      authUser.userId,
      PermissionCode.TEACHER_PROFILE_READ,
      profile.departmentId,
    )

    return this.service.findDetail(params.id, scope)
  }

  @Post()
  @RequirePermissions(PermissionCode.TEACHER_PROFILE_CREATE)
  @ApiOperation({ summary: '为已存在的用户创建教师档案' })
  @ApiSuccessResponse({ status: 201, description: '创建成功', dataSchema: { type: 'object' } })
  @ApiErrorResponse({
    status: 400,
    code: 40001,
    message: '请求参数校验失败',
    dataSchema: validationIssuesSchema,
  })
  @ApiErrorResponse({ status: 403, code: 40300, message: '没有在该院系创建教师档案的权限' })
  @ApiErrorResponse({ status: 409, code: 40900, message: '工号或教师账号已存在' })
  async create(
    @CurrentUser() authUser: AuthUserContext,
    @Body({ schema: createTeacherProfileSchema }) body: CreateTeacherProfileBody,
  ) {
    await this.scopeService.assertOrgUnitAccess(
      authUser.userId,
      PermissionCode.TEACHER_PROFILE_CREATE,
      body.departmentId,
    )

    return this.service.create(
      {
        userId: body.userId,
        teacherNo: body.teacherNo,
        departmentId: body.departmentId,
      },
      authUser.userId,
    )
  }

  @Patch(':id/department')
  @RequirePermissions(PermissionCode.TEACHER_PROFILE_DEPARTMENT_UPDATE)
  @ApiOperation({
    summary: '调整教师主要所属院系',
    description: '仅学校管理员；存在不属于目标院系的有效班级职责时返回 409。',
  })
  @ApiSuccessResponse({ description: '调整成功', dataSchema: { type: 'object' } })
  @ApiErrorResponse({ status: 403, code: 40300, message: '没有调整该教师院系的权限' })
  @ApiErrorResponse({ status: 409, code: 40900, message: '教师仍有不属于目标院系的班级职责' })
  async adjustDepartment(
    @CurrentUser() authUser: AuthUserContext,
    @Param({ schema: idParamSchema }) params: IdParam,
    @Body({ schema: adjustTeacherDepartmentSchema }) body: AdjustTeacherDepartmentBody,
  ) {
    const profile = await this.service.findById(params.id)

    await this.scopeService.assertOrgUnitAccess(
      authUser.userId,
      PermissionCode.TEACHER_PROFILE_DEPARTMENT_UPDATE,
      profile.departmentId,
    )

    await this.scopeService.assertOrgUnitAccess(
      authUser.userId,
      PermissionCode.TEACHER_PROFILE_DEPARTMENT_UPDATE,
      body.departmentId,
    )

    return this.service.adjustDepartment(params.id, body.departmentId, authUser.userId)
  }

  @Patch(':id/status')
  @RequirePermissions(PermissionCode.TEACHER_PROFILE_STATUS_UPDATE)
  @ApiOperation({
    summary: '修改教师在职状态',
    description: '状态变更后重算协管员资格；恢复 ACTIVE 不会恢复已撤销的旧角色。',
  })
  @ApiSuccessResponse({ description: '修改成功', dataSchema: { type: 'object' } })
  @ApiErrorResponse({ status: 403, code: 40300, message: '没有修改该教师在职状态的权限' })
  async updateStatus(
    @CurrentUser() authUser: AuthUserContext,
    @Param({ schema: idParamSchema }) params: IdParam,
    @Body({ schema: updateTeacherEmploymentStatusSchema })
    body: UpdateTeacherEmploymentStatusBody,
  ) {
    const profile = await this.service.findById(params.id)

    await this.scopeService.assertOrgUnitAccess(
      authUser.userId,
      PermissionCode.TEACHER_PROFILE_STATUS_UPDATE,
      profile.departmentId,
    )

    return this.service.updateEmploymentStatus(params.id, body.employmentStatus, authUser.userId)
  }

  /** 列表范围：授权院系子树；departmentId 只能收窄 */
  private async resolveDepartmentIds(
    actorId: string,
    permissionCode: PermissionCode,
    requestedDepartmentId?: string,
  ): Promise<string[]> {
    const scope = await this.scopeService.resolve(actorId, permissionCode)

    if (scope.kind !== 'SUBTREE') {
      throw new ForbiddenException({
        code: 40300,
        data: null,
        message: '没有可用的教师档案管理组织范围',
      })
    }

    if (requestedDepartmentId) {
      await this.scopeService.assertOrgUnitAccess(actorId, permissionCode, requestedDepartmentId)

      if (!scope.orgUnitIds.includes(requestedDepartmentId)) {
        throw new ForbiddenException({
          code: 40300,
          data: null,
          message: '目标院系不在授权范围内',
        })
      }

      return [requestedDepartmentId]
    }

    return scope.orgUnitIds
  }

  private async assertDepartmentAccess(
    actorId: string,
    permissionCode: PermissionCode,
    departmentId: string,
  ): Promise<string[]> {
    const scope = await this.scopeService.resolve(actorId, permissionCode)

    if (scope.kind !== 'SUBTREE') {
      throw new ForbiddenException({
        code: 40300,
        data: null,
        message: '没有可用的教师档案管理范围',
      })
    }

    await this.scopeService.assertOrgUnitAccess(actorId, permissionCode, departmentId)

    return scope.orgUnitIds
  }
}
