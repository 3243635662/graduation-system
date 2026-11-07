import { createParamDecorator, type ExecutionContext } from '@nestjs/common'

import type { AuthenticatedRequest, AuthUserContext } from '../types/auth-user.type.js'

/**
 * 获取当前登录用户上下文
 *
 * 必须在 AccessTokenGuard 之后使用，否则 request.user 为空。
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUserContext => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()

    return request.user as AuthUserContext
  },
)
