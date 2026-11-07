import type { Request } from 'express'

/**
 * 经过 AccessTokenGuard 校验后挂载到 request 上的认证上下文
 *
 * 身份只来源于已验签的 Access Token，不信任前端传递的 userId / roleId。
 */
export interface AuthUserContext {
  userId: string
  sessionId: string
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUserContext
}
