import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common'

import { PrismaService } from '../../../prisma/prisma.service.js'
import { TokenService } from '../services/token.service.js'
import type { AuthenticatedRequest } from '../types/auth-user.type.js'
import { extractBearerToken } from '../utils/bearer-token.util.js'

function unauthorized(message: string): UnauthorizedException {
  return new UnauthorizedException({ code: 40101, data: null, message })
}

/**
 * Access Token 守卫
 *
 * 除验签与有效期外，还会检查会话状态与用户状态：
 * 退出登录后会话被撤销，Access Token 会立即失效，而不仅仅是等它自然过期。
 */
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly tokenService: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    const token = extractBearerToken(request.headers.authorization)

    if (!token) {
      throw unauthorized('未登录或凭证已失效')
    }

    const payload = this.tokenService.verifyAccessToken(token)

    const session = await this.prisma.authSession.findUnique({
      where: { id: payload.sid },
      select: {
        id: true,
        revokedAt: true,
        expiresAt: true,
        user: {
          select: {
            id: true,
            status: true,
          },
        },
      },
    })

    if (
      !session ||
      session.revokedAt ||
      session.expiresAt.getTime() <= Date.now() ||
      session.user.status !== 'ACTIVE'
    ) {
      throw unauthorized('登录状态已失效，请重新登录')
    }

    request.user = {
      userId: payload.sub,
      sessionId: payload.sid,
    }

    return true
  }
}
