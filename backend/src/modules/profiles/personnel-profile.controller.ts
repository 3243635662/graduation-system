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
  createPersonnelProfileSchema,
  personnelProfileListQuerySchema,
  updatePersonnelProfileSchema,
  updatePersonnelStatusSchema,
  type CreatePersonnelProfileBody,
  type PersonnelProfileListQuery,
  type UpdatePersonnelProfileBody,
  type UpdatePersonnelStatusBody,
} from './personnel-profile.schema.js'
import { PersonnelProfileService } from './personnel-profile.service.js'

/**
 * 工作人员档案管理
 *
 * 教师、辅导员、院系行政等非学生人员共用一份档案；
 * 数据范围统一由 OrganizationScopeService 按 personnel:profile:* 计算，
 * 查询条件全部下推到 Prisma where，不在内存过滤。
 */
@ApiTags('工作人员档案')
@ApiBearerAuth('access-token')
@Controller('personnel-profiles')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class PersonnelProfileController {
  constructor(
    private readonly service: PersonnelProfileService,
    private readonly scopeService: OrganizationScopeService,
  ) {}

  @Get()
  @RequirePermissions(PermissionCode.PERSONNEL_PROFILE_READ)
  @ApiOperation({
    summary: '分页查询授权组织范围内的工作人员档案',
    description: 'organizationId 只能把范围收窄到授权范围内的某个节点，不能扩大范围。',
  })
  @ApiSuccessResponse({ description: '查询成功', dataSchema: { type: 'object' } })
  @ApiErrorResponse({ status: 401, code: 40101, message: '未登录或登录状态已失效' })
  @ApiErrorResponse({ status: 403, code: 40300, message: '没有访问该组织范围工作人员档案的权限' })
  async list(
    @CurrentUser() authUser: AuthUserContext,
    @Query({ schema: personnelProfileListQuerySchema }) query: PersonnelProfileListQuery,
  ) {
    const organizationIds = await this.resolveOrganizationIds(
      authUser.userId,
      PermissionCode.PERSONNEL_PROFILE_READ,
      query.organizationId,
    )

    return this.service.list({
      organizationIds,
      page: query.page,
      pageSize: query.pageSize,
      keyword: query.keyword,
      employeeNo: query.employeeNo,
      realName: query.realName,
      organizationId: query.organizationId,
      status: query.status,
      teacherOnly: query.teacherOnly === 'true',
    })
  }

  @Get(':id')
  @RequirePermissions(PermissionCode.PERSONNEL_PROFILE_READ)
  @ApiOperation({ summary: '工作人员档案详情（含账号摘要、正式组织与教师身份）' })
  @ApiErrorResponse({ status: 403, code: 40300, message: '没有访问该工作人员档案的权限' })
  @ApiErrorResponse({ status: 404, code: 40400, message: '工作人员档案不存在' })
  async findOne(
    @CurrentUser() authUser: AuthUserContext,
    @Param({ schema: idParamSchema }) params: IdParam,
  ) {
    const profile = await this.service.findById(params.id)

    await this.assertOrganizationAccess(
      authUser.userId,
      PermissionCode.PERSONNEL_PROFILE_READ,
      profile.primaryOrganizationUnitId,
    )

    return this.service.findDetail(params.id)
  }

  @Post()
  @RequirePermissions(PermissionCode.PERSONNEL_PROFILE_CREATE)
  @ApiOperation({
    summary: '为已存在的用户创建工作人员档案',
    description: '正式组织归属只能是 SCHOOL / DEPARTMENT / MAJOR，不允许班级。',
  })
  @ApiSuccessResponse({ status: 201, description: '创建成功', dataSchema: { type: 'object' } })
  @ApiErrorResponse({
    status: 400,
    code: 40001,
    message: '请求参数校验失败或组织节点类型非法',
    dataSchema: validationIssuesSchema,
  })
  @ApiErrorResponse({ status: 403, code: 40300, message: '没有在该组织下创建工作人员档案的权限' })
  @ApiErrorResponse({ status: 409, code: 40900, message: '工号或绑定用户已存在' })
  async create(
    @CurrentUser() authUser: AuthUserContext,
    @Body({ schema: createPersonnelProfileSchema }) body: CreatePersonnelProfileBody,
  ) {
    await this.scopeService.assertOrgUnitAccess(
      authUser.userId,
      PermissionCode.PERSONNEL_PROFILE_CREATE,
      body.primaryOrganizationUnitId,
    )

    return this.service.create(
      {
        userId: body.userId,
        employeeNo: body.employeeNo ?? null,
        primaryOrganizationUnitId: body.primaryOrganizationUnitId,
        positionName: body.positionName ?? null,
      },
      authUser.userId,
    )
  }

  @Patch(':id')
  @RequirePermissions(PermissionCode.PERSONNEL_PROFILE_UPDATE)
  @ApiOperation({
    summary: '修改工号、岗位与正式组织归属',
    description:
      '绑定账号不可变更；换组织时若教师仍有不属于目标组织子树的有效班主任任职，返回 409。',
  })
  @ApiSuccessResponse({ description: '修改成功', dataSchema: { type: 'object' } })
  @ApiErrorResponse({ status: 403, code: 40300, message: '没有修改该工作人员档案的权限' })
  @ApiErrorResponse({ status: 404, code: 40400, message: '工作人员档案不存在' })
  @ApiErrorResponse({ status: 409, code: 40900, message: '工号已存在或教师仍有跨组织班级任职' })
  async update(
    @CurrentUser() authUser: AuthUserContext,
    @Param({ schema: idParamSchema }) params: IdParam,
    @Body({ schema: updatePersonnelProfileSchema }) body: UpdatePersonnelProfileBody,
  ) {
    const profile = await this.service.findById(params.id)

    await this.assertOrganizationAccess(
      authUser.userId,
      PermissionCode.PERSONNEL_PROFILE_UPDATE,
      profile.primaryOrganizationUnitId,
    )

    if (
      body.primaryOrganizationUnitId &&
      body.primaryOrganizationUnitId !== profile.primaryOrganizationUnitId
    ) {
      await this.assertOrganizationAccess(
        authUser.userId,
        PermissionCode.PERSONNEL_PROFILE_UPDATE,
        body.primaryOrganizationUnitId,
      )
    }

    return this.service.updateBasic(params.id, body, authUser.userId)
  }

  @Patch(':id/status')
  @RequirePermissions(PermissionCode.PERSONNEL_PROFILE_UPDATE)
  @ApiOperation({
    summary: '修改工作人员任职状态',
    description:
      '同步更新教师身份状态，并在同一事务内重算协管员资格；恢复 ACTIVE 不会恢复已撤销的旧角色。',
  })
  @ApiSuccessResponse({ description: '修改成功', dataSchema: { type: 'object' } })
  @ApiErrorResponse({ status: 403, code: 40300, message: '没有修改该工作人员任职状态的权限' })
  @ApiErrorResponse({ status: 404, code: 40400, message: '工作人员档案不存在' })
  async updateStatus(
    @CurrentUser() authUser: AuthUserContext,
    @Param({ schema: idParamSchema }) params: IdParam,
    @Body({ schema: updatePersonnelStatusSchema }) body: UpdatePersonnelStatusBody,
  ) {
    const profile = await this.service.findById(params.id)

    await this.assertOrganizationAccess(
      authUser.userId,
      PermissionCode.PERSONNEL_PROFILE_UPDATE,
      profile.primaryOrganizationUnitId,
    )

    return this.service.updateStatus(params.id, body.status, authUser.userId)
  }

  /** 列表范围：授权组织子树；organizationId 只能收窄，不能扩大 */
  private async resolveOrganizationIds(
    actorId: string,
    permissionCode: PermissionCode,
    requestedOrganizationId?: string,
  ): Promise<string[]> {
    const scope = await this.scopeService.resolve(actorId, permissionCode)

    if (scope.kind !== 'SUBTREE') {
      throw new ForbiddenException({
        code: 40300,
        data: null,
        message: '没有可用的工作人员档案管理组织范围',
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

  /** 单档案访问：必须拥有该权限下的组织子树范围，且档案归属节点在范围内 */
  private async assertOrganizationAccess(
    actorId: string,
    permissionCode: PermissionCode,
    organizationId: string,
  ): Promise<void> {
    const scope = await this.scopeService.resolve(actorId, permissionCode)

    if (scope.kind !== 'SUBTREE') {
      throw new ForbiddenException({
        code: 40300,
        data: null,
        message: '没有可用的工作人员档案管理组织范围',
      })
    }

    await this.scopeService.assertOrgUnitAccess(actorId, permissionCode, organizationId)
  }
}
