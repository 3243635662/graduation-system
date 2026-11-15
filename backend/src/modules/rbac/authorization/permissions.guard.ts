import type { PermissionCode } from '@graduation/shared'
import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import type { AuthenticatedRequest } from '../../auth/types/auth-user.type.js'
import { PermissionService } from './permission.service.js'
import { REQUIRED_PERMISSIONS_KEY } from './require-permissions.decorator.js'

function unauthorized(): UnauthorizedException {
  return new UnauthorizedException({ code: 40101, data: null, message: '未登录或凭证已失效' })
}

/**
 * 功能权限守卫
 *
 * 必须与 AccessTokenGuard 同时使用：AccessTokenGuard 负责身份与会话有效性，
 * 本守卫负责「这个用户是否拥有接口要求的功能权限」。
 *
 * 数据范围不在这里判断：它属于每条权限对应的具体资源，
 * 由 OrganizationScopeService / 业务查询条件负责。
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionService: PermissionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required =
      this.reflector.getAllAndOverride<PermissionCode[]>(REQUIRED_PERMISSIONS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? []

    // 未声明权限的接口只要求登录（由 AccessTokenGuard 保证）
    if (required.length === 0) return true

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    const user = request.user

    if (!user) throw unauthorized()

    for (const permission of required) {
      const granted = await this.permissionService.hasPermission(user.userId, permission)

      if (!granted) {
        throw new ForbiddenException({
          code: 40300,
          data: null,
          message: '没有执行该操作的权限',
        })
      }
    }

    return true
  }
}
