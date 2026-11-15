import { PermissionCode } from '@graduation/shared'
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger'

import { ApiErrorResponse } from '../../../common/decorators/api-error-response.decorator.js'
import { ApiSuccessResponse } from '../../../common/decorators/api-success-response.decorator.js'
import { validationIssuesSchema } from '../../../common/openapi/validation-issues.schema.js'
import { idParamSchema, type IdParam } from '../../../common/schemas/id-param.schema.js'
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js'
import { AccessTokenGuard } from '../../auth/guards/access-token.guard.js'
import type { AuthUserContext } from '../../auth/types/auth-user.type.js'
import { MenuCacheInvalidatorService } from '../../menus/menu-cache-invalidator.service.js'
import { OrganizationScopeService } from '../authorization/organization-scope.service.js'
import { PermissionsGuard } from '../authorization/permissions.guard.js'
import { RequirePermissions } from '../authorization/require-permissions.decorator.js'
import { organizationTreeNodeSchema } from './organization-response.schema.js'
import {
  createOrganizationSchema,
  organizationTreeQuerySchema,
  updateOrganizationSchema,
  type CreateOrganizationBody,
  type OrganizationTreeQuery,
  type UpdateOrganizationBody,
} from './organization.schema.js'
import { OrganizationService } from './organization.service.js'

/**
 * 组织架构接口
 *
 * 三层保护同时生效，缺一不可：
 * 1. AccessTokenGuard：登录与会话有效。
 * 2. PermissionsGuard：拥有对应功能权限。
 * 3. OrganizationScopeService：数据范围参与数据库查询 / 目标节点校验。
 */
@ApiTags('RBAC - 组织架构')
@ApiBearerAuth('access-token')
@Controller('organizations')
@UseGuards(AccessTokenGuard, PermissionsGuard)
export class OrganizationController {
  constructor(
    private readonly organizationService: OrganizationService,
    private readonly scopeService: OrganizationScopeService,
    private readonly menuCacheInvalidator: MenuCacheInvalidatorService,
  ) {}

  @Get('tree')
  @RequirePermissions(PermissionCode.ORGANIZATION_READ)
  @ApiOperation({
    summary: '获取当前用户可见的组织树',
    description:
      '返回结果已按当前用户授予 organization:unit:read 的角色范围裁剪，客户端传入的任何组织 ID 都无法扩大范围。',
  })
  @ApiSuccessResponse({
    description: '获取组织树成功',
    dataSchema: { type: 'array', items: organizationTreeNodeSchema },
  })
  @ApiErrorResponse({ status: 401, code: 40101, message: '未登录或登录状态已失效' })
  @ApiErrorResponse({ status: 403, code: 40300, message: '没有执行该操作的权限' })
  async getTree(
    @CurrentUser() authUser: AuthUserContext,
    @Query({ schema: organizationTreeQuerySchema }) query: OrganizationTreeQuery,
  ) {
    const filter = await this.scopeService.buildOrgUnitFilter(
      authUser.userId,
      PermissionCode.ORGANIZATION_READ,
    )

    return this.organizationService.getTree(query.includeDisabled === 'true', filter?.id.in)
  }

  @Get(':id')
  @RequirePermissions(PermissionCode.ORGANIZATION_READ)
  @ApiOperation({ summary: '获取组织节点详情' })
  @ApiParam({
    name: 'id',
    description: '组织节点 ID（UUID）',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiSuccessResponse({ description: '获取组织节点成功', dataSchema: organizationTreeNodeSchema })
  @ApiErrorResponse({ status: 401, code: 40101, message: '未登录或登录状态已失效' })
  @ApiErrorResponse({ status: 403, code: 40300, message: '没有访问该组织范围数据的权限' })
  @ApiErrorResponse({
    status: 404,
    code: 40400,
    message: '组织节点不存在',
  })
  async findOne(
    @CurrentUser() authUser: AuthUserContext,
    @Param({ schema: idParamSchema }) params: IdParam,
  ) {
    await this.scopeService.assertOrgUnitAccess(
      authUser.userId,
      PermissionCode.ORGANIZATION_READ,
      params.id,
    )

    return this.organizationService.findById(params.id)
  }

  @Post()
  @RequirePermissions(PermissionCode.ORGANIZATION_CREATE)
  @ApiOperation({
    summary: '创建组织节点',
    description: '只能在授权范围内创建下级节点；学校根节点由系统初始化创建，不允许通过接口新增。',
  })
  @ApiSuccessResponse({
    status: 201,
    description: '创建组织节点成功',
    dataSchema: organizationTreeNodeSchema,
  })
  @ApiErrorResponse({
    status: 400,
    code: 40001,
    message: '请求参数校验失败',
    dataSchema: validationIssuesSchema,
  })
  @ApiErrorResponse({ status: 403, code: 40300, message: '没有访问该组织范围数据的权限' })
  @ApiErrorResponse({ status: 409, code: 40900, message: '组织编码已存在' })
  async create(
    @CurrentUser() authUser: AuthUserContext,
    @Body({ schema: createOrganizationSchema }) body: CreateOrganizationBody,
  ) {
    if (body.type === 'SCHOOL') {
      throw new BadRequestException('学校根节点由系统初始化创建，不支持通过接口新增')
    }

    if (!body.parentId) {
      throw new BadRequestException('院系、专业、班级必须指定父组织')
    }

    await this.scopeService.assertOrgUnitAccess(
      authUser.userId,
      PermissionCode.ORGANIZATION_CREATE,
      body.parentId,
    )

    return this.organizationService.create(
      {
        name: body.name,
        code: body.code,
        type: body.type,
        parentId: body.parentId,
        sortOrder: body.sortOrder,
      },
      authUser.userId,
    )
  }

  @Patch(':id')
  @RequirePermissions(PermissionCode.ORGANIZATION_UPDATE)
  @ApiOperation({
    summary: '修改组织节点',
    description: '只允许修改名称、排序与启用状态；编码、类型与父节点不可变。',
  })
  @ApiParam({
    name: 'id',
    description: '组织节点 ID（UUID）',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiSuccessResponse({ description: '修改组织节点成功', dataSchema: organizationTreeNodeSchema })
  @ApiErrorResponse({
    status: 400,
    code: 40001,
    message: '请求参数校验失败',
    dataSchema: validationIssuesSchema,
  })
  @ApiErrorResponse({ status: 403, code: 40300, message: '没有访问该组织范围数据的权限' })
  @ApiErrorResponse({ status: 404, code: 40400, message: '组织节点不存在' })
  async update(
    @CurrentUser() authUser: AuthUserContext,
    @Param({ schema: idParamSchema }) params: IdParam,
    @Body({ schema: updateOrganizationSchema }) body: UpdateOrganizationBody,
  ) {
    // 修改/启用需要能看到已停用的后代，否则停用后无法恢复；
    // 授权根与祖先链仍必须 ACTIVE，越权范围依旧被拦截。
    await this.scopeService.assertOrgUnitAccess(
      authUser.userId,
      PermissionCode.ORGANIZATION_UPDATE,
      params.id,
      { includeDisabledDescendants: true },
    )

    // 只有状态变化会影响授权与菜单，改名/排序无需让全局菜单缓存失效
    if (body.status === undefined) {
      return this.organizationService.update(params.id, body)
    }

    return this.menuCacheInvalidator.commitThenInvalidate('organization.update-status', () =>
      this.organizationService.update(params.id, body),
    )
  }
}
