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
import { OrganizationService } from '../rbac/organizations/organization.service.js'
import {
  createStudentProfileSchema,
  studentProfileListQuerySchema,
  transferStudentProfileSchema,
  updateEnrollmentStatusSchema,
  updateStudentProfileSchema,
  type CreateStudentProfileBody,
  type StudentProfileListQuery,
  type TransferStudentProfileBody,
  type UpdateEnrollmentStatusBody,
  type UpdateStudentProfileBody,
} from './student-profile.schema.js'
import { StudentProfileService } from './student-profile.service.js'

/**
 * 学生档案管理
 *
 * 每个写接口都有独立权限；数据范围统一由 OrganizationScopeService 计算，
 * 查询条件在 Prisma where 中生效，不在内存过滤。
 */
@ApiTags('学生档案')
@ApiBearerAuth('access-token')
@Controller('student-profiles')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class StudentProfileController {
  constructor(
    private readonly service: StudentProfileService,
    private readonly scopeService: OrganizationScopeService,
    private readonly organizationService: OrganizationService,
  ) {}

  @Get()
  @RequirePermissions(PermissionCode.STUDENT_PROFILE_READ)
  @ApiOperation({ summary: '分页查询授权范围内的学生档案' })
  @ApiSuccessResponse({ description: '查询成功', dataSchema: { type: 'object' } })
  @ApiErrorResponse({ status: 401, code: 40101, message: '未登录或登录状态已失效' })
  @ApiErrorResponse({ status: 403, code: 40300, message: '没有访问该组织范围学生档案的权限' })
  async list(
    @CurrentUser() authUser: AuthUserContext,
    @Query({ schema: studentProfileListQuerySchema }) query: StudentProfileListQuery,
  ) {
    const classIds = await this.resolveClassIds(
      authUser.userId,
      PermissionCode.STUDENT_PROFILE_READ,
      query,
    )

    return this.service.list({
      classIds,
      page: query.page,
      pageSize: query.pageSize,
      keyword: query.keyword,
      studentNo: query.studentNo,
      realName: query.realName,
      classId: query.classId,
      enrollmentStatus: query.enrollmentStatus,
      unassignedOnly: query.unassignedOnly === 'true',
    })
  }

  @Get(':id')
  @RequirePermissions(PermissionCode.STUDENT_PROFILE_READ)
  @ApiOperation({ summary: '学生档案详情（含账号摘要与分班历史）' })
  @ApiErrorResponse({ status: 403, code: 40300, message: '没有访问该学生档案的权限' })
  @ApiErrorResponse({ status: 404, code: 40400, message: '学生档案不存在' })
  async findOne(
    @CurrentUser() authUser: AuthUserContext,
    @Param({ schema: idParamSchema }) params: IdParam,
  ) {
    const profile = await this.service.findById(params.id)

    await this.assertClassScope(
      authUser.userId,
      PermissionCode.STUDENT_PROFILE_READ,
      profile.classId,
    )

    return this.service.findDetail(params.id)
  }

  @Post()
  @RequirePermissions(PermissionCode.STUDENT_PROFILE_CREATE)
  @ApiOperation({ summary: '为已存在的学生账号创建档案（可暂不分班）' })
  @ApiSuccessResponse({ status: 201, description: '创建成功', dataSchema: { type: 'object' } })
  @ApiErrorResponse({
    status: 400,
    code: 40001,
    message: '请求参数校验失败',
    dataSchema: validationIssuesSchema,
  })
  @ApiErrorResponse({ status: 403, code: 40300, message: '没有在该班级创建学生档案的权限' })
  @ApiErrorResponse({ status: 409, code: 40900, message: '学号或绑定用户已存在' })
  async create(
    @CurrentUser() authUser: AuthUserContext,
    @Body({ schema: createStudentProfileSchema }) body: CreateStudentProfileBody,
  ) {
    await this.assertClassScope(
      authUser.userId,
      PermissionCode.STUDENT_PROFILE_CREATE,
      body.classId ?? null,
    )

    return this.service.create(
      {
        userId: body.userId,
        studentNo: body.studentNo,
        classId: body.classId ?? null,
        enrollmentYear: body.enrollmentYear ?? null,
      },
      authUser.userId,
    )
  }

  @Patch(':id')
  @RequirePermissions(PermissionCode.STUDENT_PROFILE_UPDATE)
  @ApiOperation({ summary: '修改学号与入学年份（班级变更走转班接口）' })
  @ApiSuccessResponse({ description: '修改成功', dataSchema: { type: 'object' } })
  @ApiErrorResponse({ status: 403, code: 40300, message: '没有修改该学生档案的权限' })
  async update(
    @CurrentUser() authUser: AuthUserContext,
    @Param({ schema: idParamSchema }) params: IdParam,
    @Body({ schema: updateStudentProfileSchema }) body: UpdateStudentProfileBody,
  ) {
    const profile = await this.service.findById(params.id)

    await this.assertClassScope(
      authUser.userId,
      PermissionCode.STUDENT_PROFILE_UPDATE,
      profile.classId,
    )

    return this.service.updateBasic(params.id, body, authUser.userId)
  }

  @Post(':id/transfer')
  @RequirePermissions(PermissionCode.STUDENT_PROFILE_TRANSFER)
  @ApiOperation({
    summary: '学生首次分班或转班',
    description: '目标班级必须在操作者范围内；事务内锁档案与班级，写变更历史并重算协管资格。',
  })
  @ApiSuccessResponse({ description: '操作成功', dataSchema: { type: 'object' } })
  @ApiErrorResponse({ status: 400, code: 40001, message: '目标班级不合法或原班级与目标班级相同' })
  @ApiErrorResponse({ status: 403, code: 40300, message: '没有在原班级或目标班级操作的权限' })
  @ApiErrorResponse({ status: 409, code: 40900, message: '学生班级已被其他操作修改' })
  async transfer(
    @CurrentUser() authUser: AuthUserContext,
    @Param({ schema: idParamSchema }) params: IdParam,
    @Body({ schema: transferStudentProfileSchema }) body: TransferStudentProfileBody,
  ) {
    const profile = await this.service.findById(params.id)

    await this.assertClassScope(
      authUser.userId,
      PermissionCode.STUDENT_PROFILE_TRANSFER,
      profile.classId,
    )

    await this.scopeService.assertOrgUnitAccess(
      authUser.userId,
      PermissionCode.STUDENT_PROFILE_TRANSFER,
      body.targetClassId,
    )

    return this.service.changeClass(
      params.id,
      body.targetClassId,
      body.reason,
      authUser.userId,
      profile.classId,
    )
  }

  @Patch(':id/status')
  @RequirePermissions(PermissionCode.STUDENT_PROFILE_STATUS_UPDATE)
  @ApiOperation({ summary: '修改学籍状态（休学/毕业/退学/恢复）' })
  @ApiSuccessResponse({ description: '修改成功', dataSchema: { type: 'object' } })
  @ApiErrorResponse({ status: 403, code: 40300, message: '没有修改该学生学籍状态的权限' })
  async updateStatus(
    @CurrentUser() authUser: AuthUserContext,
    @Param({ schema: idParamSchema }) params: IdParam,
    @Body({ schema: updateEnrollmentStatusSchema }) body: UpdateEnrollmentStatusBody,
  ) {
    const profile = await this.service.findById(params.id)

    await this.assertClassScope(
      authUser.userId,
      PermissionCode.STUDENT_PROFILE_STATUS_UPDATE,
      profile.classId,
    )

    return this.service.updateEnrollmentStatus(params.id, body.enrollmentStatus, authUser.userId)
  }

  /** 查询参数只能在授权范围内收窄；不返回空范围时的全量数据 */
  private async resolveClassIds(
    actorId: string,
    permissionCode: PermissionCode,
    query: StudentProfileListQuery,
  ): Promise<string[]> {
    const scope = await this.scopeService.resolve(actorId, permissionCode)

    if (scope.kind !== 'SUBTREE') {
      throw new ForbiddenException({
        code: 40300,
        data: null,
        message: '没有可用的学生档案管理组织范围',
      })
    }

    const allowed = new Set(scope.orgUnitIds)

    if (query.classId) {
      await this.scopeService.assertOrgUnitAccess(actorId, permissionCode, query.classId)

      if (!allowed.has(query.classId)) {
        throw new ForbiddenException({ code: 40300, data: null, message: '目标班级不在授权范围内' })
      }

      return [query.classId]
    }

    if (query.orgUnitId) {
      await this.scopeService.assertOrgUnitAccess(actorId, permissionCode, query.orgUnitId)

      const subtree = await this.organizationService.getSubtreeIds(query.orgUnitId)
      const narrowed = subtree.filter((id) => allowed.has(id))

      if (narrowed.length === 0) {
        throw new ForbiddenException({ code: 40300, data: null, message: '目标组织不在授权范围内' })
      }

      return narrowed
    }

    return [...allowed]
  }

  /**
   * 学生尚未分班时无法按班级校验范围，
   * 此时退化为「必须拥有该权限下的任意可管理范围」，避免无权限者操作未分班学生。
   */
  private async assertClassScope(
    actorId: string,
    permissionCode: PermissionCode,
    classId: string | null,
  ): Promise<void> {
    if (classId) {
      await this.scopeService.assertOrgUnitAccess(actorId, permissionCode, classId)
      return
    }

    const scope = await this.scopeService.resolve(actorId, permissionCode)

    if (scope.kind === 'NONE') {
      throw new ForbiddenException({
        code: 40300,
        data: null,
        message: '没有可用的学生档案管理组织范围',
      })
    }
  }
}
