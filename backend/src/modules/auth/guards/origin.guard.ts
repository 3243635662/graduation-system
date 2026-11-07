import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common'
import type { Request } from 'express'

function parseAllowedOrigins(raw: string | undefined): string[] {
  return (raw ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
}

/**
 * 依赖 Refresh Cookie 的接口（refresh / logout）的来源校验。
 *
 * 为什么需要：
 * - CORS 只限制「能否读取响应」，不能阻止请求被发出；
 * - SameSite=Lax 能挡住大多数跨站 POST，但浏览器 Cookie 策略在演进，
 *   且未来若改为 SameSite=None / 跨子域部署，必须额外做 CSRF 防护。
 *
 * 策略：
 * - 浏览器对跨域/同源 POST 都会带 Origin，只要带了就必须命中 CORS_ORIGIN 白名单；
 * - 非浏览器客户端（curl、服务端调用、Swagger）通常不带 Origin，放行，
 *   此时由 HttpOnly Cookie + SameSite + Token 本身兜底。
 */
@Injectable()
export class OriginGuard implements CanActivate {
  private allowedOrigins: string[] | null = null

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>()
    const origin = request.headers.origin

    if (!origin) return true

    if (this.getAllowedOrigins().includes(origin)) return true

    throw new ForbiddenException({
      code: 40300,
      data: null,
      message: '请求来源不被允许',
    })
  }

  private getAllowedOrigins(): string[] {
    this.allowedOrigins ??= parseAllowedOrigins(process.env['CORS_ORIGIN'])

    return this.allowedOrigins
  }
}
