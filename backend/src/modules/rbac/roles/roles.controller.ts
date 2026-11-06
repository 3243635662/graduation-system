import { Controller, Get, Param } from '@nestjs/common'
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger'

import { ApiErrorResponse } from '../../../common/decorators/api-error-response.decorator.js'
import { ApiSuccessResponse } from '../../../common/decorators/api-success-response.decorator.js'
import { validationIssuesSchema } from '../../../common/openapi/validation-issues.schema.js'
import { idParamSchema, type IdParam } from '../../../common/schemas/id-param.schema.js'
import { roleSchema } from './roles.schema.js'
import { RolesService } from './roles.service.js'

@ApiTags('RBAC - 角色管理')
@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  /**
   * 获取系统角色列表
   */
  @Get()
  @ApiOperation({ summary: '获取系统角色列表' })
  @ApiSuccessResponse({
    description: '获取角色列表成功',
    dataSchema: {
      type: 'array',
      items: roleSchema,
    },
  })
  @ApiErrorResponse({
    status: 500,
    code: 50000,
    message: '服务器内部错误',
  })
  findAll() {
    return this.rolesService.findAll()
  }

  /**
   * 根据 ID 获取角色详情
   */
  @Get(':id')
  @ApiOperation({ summary: '获取角色详情' })
  @ApiParam({
    name: 'id',
    description: '角色 ID（UUID）',
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiSuccessResponse({
    description: '获取角色详情成功',
    dataSchema: roleSchema,
  })
  @ApiErrorResponse({
    status: 400,
    code: 40001,
    message: '请求参数校验失败',
    description: 'ID 不是合法的 UUID',
    dataSchema: validationIssuesSchema,
  })
  @ApiErrorResponse({
    status: 404,
    code: 40400,
    message: '角色不存在',
  })
  @ApiErrorResponse({
    status: 500,
    code: 50000,
    message: '服务器内部错误',
  })
  findOne(@Param({ schema: idParamSchema }) params: IdParam) {
    return this.rolesService.findOne(params.id)
  }
}
