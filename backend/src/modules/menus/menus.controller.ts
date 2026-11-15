import { Controller, Get, Header, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger'

import { ApiErrorResponse } from '../../common/decorators/api-error-response.decorator.js'
import { ApiSuccessResponse } from '../../common/decorators/api-success-response.decorator.js'
import { CurrentUser } from '../auth/decorators/current-user.decorator.js'
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js'
import type { AuthUserContext } from '../auth/types/auth-user.type.js'
import { MenusService } from './menus.service.js'
import { menuTreeNodeSchema } from './schemas/menu.schema.js'

@ApiTags('RBAC - 菜单')
@ApiBearerAuth('access-token')
@Controller('menus')
@UseGuards(AccessTokenGuard)
export class MenusController {
  constructor(private readonly menusService: MenusService) {}

  /**
   * 获取当前登录用户的菜单树
   *
   * 用户身份完全来自 Access Token 对应的认证上下文，
   * 客户端无法通过 userId / roleId 参数指定要查看谁的菜单。
   */
  @Get('current')
  @ApiOperation({
    summary: '获取当前登录用户的菜单树',
    description:
      '按当前用户的有效角色合并 RoleMenu 授权，自动补齐 DIRECTORY 父节点并按 sortOrder 排序；结果按用户缓存在 Redis。',
  })
  @ApiHeader({
    name: 'Authorization',
    description: 'Bearer <accessToken>',
    required: true,
  })
  @ApiSuccessResponse({
    description: '获取当前用户菜单成功',
    dataSchema: {
      type: 'array',
      items: menuTreeNodeSchema,
    },
  })
  @ApiErrorResponse({
    status: 401,
    code: 40101,
    message: '未登录或登录状态已失效',
  })
  @ApiErrorResponse({
    status: 500,
    code: 50000,
    message: '服务器内部错误',
  })
  // 个性化授权数据：禁止浏览器/CDN/共享代理缓存
  @Header('Cache-Control', 'private, no-store')
  getCurrentMenus(@CurrentUser() authUser: AuthUserContext) {
    return this.menusService.getCurrentUserMenus(authUser.userId)
  }
}
