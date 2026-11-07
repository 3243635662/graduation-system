import type { AuthResult } from '@graduation/shared'
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common'
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Request, Response } from 'express'

import { ApiErrorResponse } from '../../common/decorators/api-error-response.decorator.js'
import { ApiSuccessResponse } from '../../common/decorators/api-success-response.decorator.js'
import { validationIssuesSchema } from '../../common/openapi/validation-issues.schema.js'
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator.js'
import { RateLimitGuard } from '../../common/rate-limit/rate-limit.guard.js'
import { AuthService } from './auth.service.js'
import { getRefreshCookieOptions } from './config/auth.config.js'
import { CurrentUser } from './decorators/current-user.decorator.js'
import { AccessTokenGuard } from './guards/access-token.guard.js'
import { OriginGuard } from './guards/origin.guard.js'
import { authResultSchema, authUserSchema } from './schemas/auth-response.schema.js'
import { loginSchema, type LoginInput } from './schemas/login.schema.js'
import { registerSchema, type RegisterInput } from './schemas/register.schema.js'
import { TokenService } from './services/token.service.js'
import type { AuthUserContext } from './types/auth-user.type.js'
import { extractBearerToken } from './utils/bearer-token.util.js'
import { REFRESH_TOKEN_COOKIE, parseCookie, serializeCookie } from './utils/cookie.util.js'

/** Cookie 兜底有效期（秒），仅当 Token 配置异常时使用 */
const REFRESH_COOKIE_MAX_AGE_FALLBACK = 7 * 24 * 60 * 60

function getRequestMeta(request: Request) {
  return {
    ipAddress: request.ip ?? null,
    userAgent: request.headers['user-agent'] ?? null,
  }
}

/**
 * 登录限流维度：IP + 邮箱，防止对同一账号暴力破解。
 *
 * 此时 body 尚未经过 Zod 校验，只做防御性读取。
 */
function loginRateLimitKey(request: Request): string {
  const body = request.body as { email?: unknown } | undefined
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''

  return `login:${request.ip ?? 'unknown'}:${email}`
}

@ApiTags('Auth - 身份认证')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly tokenService: TokenService,
  ) {}

  /**
   * 学生注册
   *
   * 默认分配 STUDENT 角色，不接受客户端指定角色。
   */
  @Post('register')
  @UseGuards(RateLimitGuard)
  @RateLimit({ windowMs: 10 * 60_000, limit: 10 })
  @ApiOperation({ summary: '学生注册（默认 STUDENT 角色）' })
  @ApiSuccessResponse({
    status: 201,
    description: '注册成功，同时建立登录会话',
    dataSchema: authResultSchema,
  })
  @ApiErrorResponse({
    status: 400,
    code: 40001,
    message: '请求参数校验失败',
    dataSchema: validationIssuesSchema,
  })
  @ApiErrorResponse({ status: 409, code: 40900, message: '该邮箱已被注册' })
  @ApiErrorResponse({ status: 429, code: 42900, message: '请求过于频繁，请稍后再试' })
  async register(
    @Body({ schema: registerSchema }) body: RegisterInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResult> {
    const result = await this.authService.register(body, getRequestMeta(request))

    this.setRefreshCookie(response, result.refreshToken)

    return { accessToken: result.accessToken, user: result.user }
  }

  /**
   * 账号密码登录
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimitGuard)
  @RateLimit({ windowMs: 60_000, limit: 5, keyBy: loginRateLimitKey })
  @ApiOperation({ summary: '账号密码登录' })
  @ApiSuccessResponse({ description: '登录成功', dataSchema: authResultSchema })
  @ApiErrorResponse({
    status: 400,
    code: 40001,
    message: '请求参数校验失败',
    dataSchema: validationIssuesSchema,
  })
  @ApiErrorResponse({ status: 401, code: 40100, message: '邮箱或密码错误' })
  @ApiErrorResponse({ status: 403, code: 40300, message: '账号已被禁用，请联系管理员' })
  @ApiErrorResponse({ status: 429, code: 42900, message: '请求过于频繁，请稍后再试' })
  async login(
    @Body({ schema: loginSchema }) body: LoginInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResult> {
    const result = await this.authService.login(body, getRequestMeta(request))

    this.setRefreshCookie(response, result.refreshToken)

    return { accessToken: result.accessToken, user: result.user }
  }

  /**
   * 刷新 Access Token（同时轮换 Refresh Token）
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @UseGuards(OriginGuard, RateLimitGuard)
  @RateLimit({ windowMs: 60_000, limit: 30 })
  @ApiCookieAuth('refresh-token')
  @ApiOperation({ summary: '刷新 Access Token（轮换 Refresh Token）' })
  @ApiSuccessResponse({ description: '刷新成功', dataSchema: authResultSchema })
  @ApiErrorResponse({ status: 401, code: 40102, message: '刷新令牌无效或已过期' })
  @ApiErrorResponse({ status: 403, code: 40300, message: '请求来源不被允许' })
  @ApiErrorResponse({ status: 429, code: 42900, message: '请求过于频繁，请稍后再试' })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthResult> {
    const token = parseCookie(request.headers.cookie, REFRESH_TOKEN_COOKIE)
    const result = await this.authService.refresh(token)

    this.setRefreshCookie(response, result.refreshToken)

    return { accessToken: result.accessToken, user: result.user }
  }

  /**
   * 获取当前登录用户
   *
   * 身份完全来源于已验证的 Access Token，不信任请求参数。
   */
  @Get('me')
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: '获取当前登录用户' })
  @ApiSuccessResponse({ description: '获取当前用户成功', dataSchema: authUserSchema })
  @ApiErrorResponse({ status: 401, code: 40101, message: '未登录或凭证已失效' })
  getMe(@CurrentUser() authUser: AuthUserContext) {
    return this.authService.getMe(authUser)
  }

  /**
   * 退出登录
   *
   * 幂等：即使当前会话已失效，也会安全完成清理。
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(OriginGuard)
  @ApiCookieAuth('refresh-token')
  @ApiOperation({
    summary: '退出登录（撤销当前会话并清除 Refresh Cookie）',
    description:
      '优先使用已验证 Access Token 中的 sid 撤销会话；Refresh Cookie 作为补充依据。即使浏览器没有携带 Cookie，携带 Access Token 也能让当前会话立即失效。',
  })
  @ApiErrorResponse({ status: 403, code: 40300, message: '请求来源不被允许' })
  @ApiSuccessResponse({
    description: '退出成功',
    dataSchema: {
      type: 'boolean',
      example: true,
    },
  })
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<boolean> {
    const refreshToken = parseCookie(request.headers.cookie, REFRESH_TOKEN_COOKIE)
    const accessToken = extractBearerToken(request.headers.authorization)

    await this.authService.logout({ refreshToken, accessToken })
    this.clearRefreshCookie(response)

    return true
  }

  private setRefreshCookie(response: Response, token: string): void {
    const maxAge =
      Math.floor(this.tokenService.getRefreshTtlMs() / 1000) || REFRESH_COOKIE_MAX_AGE_FALLBACK

    response.setHeader(
      'Set-Cookie',
      serializeCookie(REFRESH_TOKEN_COOKIE, token, {
        ...getRefreshCookieOptions(),
        maxAge,
      }),
    )
  }

  private clearRefreshCookie(response: Response): void {
    response.setHeader(
      'Set-Cookie',
      serializeCookie(REFRESH_TOKEN_COOKIE, '', {
        ...getRefreshCookieOptions(),
        maxAge: 0,
      }),
    )
  }
}
