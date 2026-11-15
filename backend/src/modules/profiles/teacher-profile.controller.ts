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
import { PersonnelProfileService } from './personnel-profile.service.js'
import {
  createTeacherProfileSchema,
  teacherProfileListQuerySchema,
  updateTeacherEmploymentStatusSchema,
  updateTeacherProfileSchema,
  type CreateTeacherProfileBody,
  type TeacherProfileListQuery,
  type UpdateTeacherEmploymentStatusBody,
  type UpdateTeacherProfileBody,
} from './teacher-profile.schema.js'
import { TeacherProfileService } from './teacher-profile.service.js'

/**
 * 教师档案管理
 *
 * 教师身份挂在工作人员档案之下：
 * - 数据范围来自 teacher:profile:read 的组织子树；
 * - 所属组织统一取 personnelProfile.primaryOrganizationUnit；
 * - 院系调整已移动到工作人员档案（PATCH /personnel-profiles/:id）；
 * - 在职状态使用独立权限，避免用 teacher:profile:update 一把抓。
 */
@ApiTags('教师档案')
@ApiBearerAuth('access-token')
@Controller('teacher-profiles')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class TeacherProfileController {
  constructor(
    private readonly service: TeacherProfileService,
    private readonly personnelService: PersonnelProfileService,
    private readonly scopeService: OrganizationScopeService,
  ) {}

  @Get()
  @RequirePermissions(PermissionCode.TEACHER_PROFILE_READ)
  @ApiOperation({ summary: '分页查询授权组织范围内的教师档案' })
  @ApiSuccessResponse({ description: '查询成功', dataSchema: { type: 'object' } })
  @ApiErrorResponse({ status: 401, code: 40101, message: '未登录或登录状态已失效' })
  @ApiErrorResponse({ status: 403, code: 40300, message: '没有访问该组织范围教师档案的权限' })
  async list(
    @CurrentUser() authUser: AuthUserContext,
    @Query({ schema: teacherProfileListQuerySchema }) query: TeacherProfileListQuery,
  ) {
    const organizationIds = await this.resolveOrgUnitIds(
      authUser.userId,
      PermissionCode.TEACHER_PROFILE_READ,
      query.organizationId,
    )

    return this.service.list({
      organizationIds,
      page: query.page,
      pageSize: query.pageSize,
      keyword: query.keyword,
      teacherNo: query.teacherNo,
      realName: query.realName,
      organizationId: query.organizationId,
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
    const scopeOrgUnitIds = await this.resolveOrgUnitIds(
      authUser.userId,
      PermissionCode.TEACHER_PROFILE_READ,
    )

    // 班级职责先按授权组织范围裁剪，再用教师正式组织判定档案本身是否可读
    const visibleClassIds = await this.service.resolveVisibleClassIds(params.id, scopeOrgUnitIds)

    const detail = await this.service.findDetail(params.id, visibleClassIds)

    await this.scopeService.assertOrgUnitAccess(
      authUser.userId,
      PermissionCode.TEACHER_PROFILE_READ,
      detail.personnelProfile.primaryOrganizationUnitId,
    )

    return detail
  }

  @Post()
  @RequirePermissions(PermissionCode.TEACHER_PROFILE_CREATE)
  @ApiOperation({
    summary: '为已有工作人员档案创建教师身份',
    description: '教师编号唯一；所属组织与账号信息从工作人员档案读取。',
  })
  @ApiSuccessResponse({ status: 201, description: '创建成功', dataSchema: { type: 'object' } })
  @ApiErrorResponse({
    status: 400,
    code: 40001,
    message: '请求参数校验失败',
    dataSchema: validationIssuesSchema,
  })
  @ApiErrorResponse({ status: 403, code: 40300, message: '没有在该组织下创建教师档案的权限' })
  @ApiErrorResponse({ status: 404, code: 40400, message: '工作人员档案不存在' })
  @ApiErrorResponse({ status: 409, code: 40900, message: '教师编号已存在或该工作人员已有教师身份' })
  async create(
    @CurrentUser() authUser: AuthUserContext,
    @Body({ schema: createTeacherProfileSchema }) body: CreateTeacherProfileBody,
  ) {
    const personnel = await this.personnelService.findById(body.personnelProfileId)

    await this.scopeService.assertOrgUnitAccess(
      authUser.userId,
      PermissionCode.TEACHER_PROFILE_CREATE,
      personnel.primaryOrganizationUnitId,
    )

    return this.service.create(
      {
        personnelProfileId: body.personnelProfileId,
        teacherNo: body.teacherNo,
        title: body.title ?? null,
        professionalInfo: body.professionalInfo ?? null,
      },
      authUser.userId,
    )
  }

  @Patch(':id')
  @RequirePermissions(PermissionCode.TEACHER_PROFILE_UPDATE)
  @ApiOperation({
    summary: '修改教师编号、职称与专业资料',
    description: '所属组织与绑定账号不在本接口调整，请使用工作人员档案接口。',
  })
  @ApiSuccessResponse({ description: '修改成功', dataSchema: { type: 'object' } })
  @ApiErrorResponse({ status: 403, code: 40300, message: '没有修改该教师档案的权限' })
  @ApiErrorResponse({ status: 404, code: 40400, message: '教师档案不存在' })
  @ApiErrorResponse({ status: 409, code: 40900, message: '教师编号已存在' })
  async update(
    @CurrentUser() authUser: AuthUserContext,
    @Param({ schema: idParamSchema }) params: IdParam,
    @Body({ schema: updateTeacherProfileSchema }) body: UpdateTeacherProfileBody,
  ) {
    const detail = await this.service.findDetail(params.id, [])

    await this.scopeService.assertOrgUnitAccess(
      authUser.userId,
      PermissionCode.TEACHER_PROFILE_UPDATE,
      detail.personnelProfile.primaryOrganizationUnitId,
    )

    return this.service.updateBasic(params.id, body, authUser.userId)
  }

  @Patch(':id/status')
  @RequirePermissions(PermissionCode.TEACHER_PROFILE_STATUS_UPDATE)
  @ApiOperation({
    summary: '修改教师在职状态',
    description: '同时更新工作人员任职状态并重算协管员资格；恢复 ACTIVE 不会恢复已撤销的旧角色。',
  })
  @ApiSuccessResponse({ description: '修改成功', dataSchema: { type: 'object' } })
  @ApiErrorResponse({ status: 403, code: 40300, message: '没有修改该教师在职状态的权限' })
  @ApiErrorResponse({ status: 404, code: 40400, message: '教师档案不存在' })
  async updateStatus(
    @CurrentUser() authUser: AuthUserContext,
    @Param({ schema: idParamSchema }) params: IdParam,
    @Body({ schema: updateTeacherEmploymentStatusSchema })
    body: UpdateTeacherEmploymentStatusBody,
  ) {
    const detail = await this.service.findDetail(params.id, [])

    await this.scopeService.assertOrgUnitAccess(
      authUser.userId,
      PermissionCode.TEACHER_PROFILE_STATUS_UPDATE,
      detail.personnelProfile.primaryOrganizationUnitId,
    )

    return this.service.updateEmploymentStatus(params.id, body.employmentStatus, authUser.userId)
  }

  /** 授权组织子树；organizationId 只能收窄，不能扩大范围 */
  private async resolveOrgUnitIds(
    actorId: string,
    permissionCode: PermissionCode,
    requestedOrganizationId?: string,
  ): Promise<string[]> {
    const scope = await this.scopeService.resolve(actorId, permissionCode)

    if (scope.kind !== 'SUBTREE') {
      throw new ForbiddenException({
        code: 40300,
        data: null,
        message: '没有可用的教师档案管理组织范围',
      })
    }

    if (requestedOrganizationId) {
      await this.scopeService.assertOrgUnitAccess(actorId, permissionCode, requestedOrganizationId)

      if (!scope.orgUnitIds.includes(requestedOrganizationId)) {
        throw new ForbiddenException({
          code: 40300,
          data: null,
          message: '目标组织不在授权范围内',
        })
      }

      return [requestedOrganizationId]
    }

    return scope.orgUnitIds
  }
}
