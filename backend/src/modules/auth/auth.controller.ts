import type {
  AuthResult,
  AuthUser,
  BindEmailInput,
  SendBindEmailCodeInput,
  SendEmailCodeResult,
  UnbindEmailInput,
  VerifyEmailChangePasswordInput,
  VerifyEmailChangePasswordResult,
} from '@graduation/shared'
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
import { ApiSuccessResult } from '../../common/interceptors/api-success-result.js'
import { validationIssuesSchema } from '../../common/openapi/validation-issues.schema.js'
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator.js'
import { RateLimitGuard } from '../../common/rate-limit/rate-limit.guard.js'
import { AuthService } from './auth.service.js'
import { getRefreshCookieOptions } from './config/auth.config.js'
import { CurrentUser } from './decorators/current-user.decorator.js'
import { EmailChangeService } from './email-change/email-change.service.js'
import { EmailCodeService } from './email-code/email-code.service.js'
import { AccessTokenGuard } from './guards/access-token.guard.js'
import { OriginGuard } from './guards/origin.guard.js'
import {
  authResultSchema,
  authUserSchema,
  sendEmailCodeResultSchema,
} from './schemas/auth-response.schema.js'
import {
  bindEmailSchema,
  sendBindEmailCodeSchema,
  unbindEmailSchema,
  verifyEmailChangePasswordSchema,
} from './schemas/email-change.schema.js'
import { loginSchema, type LoginInput } from './schemas/login.schema.js'
import { registerSchema, type RegisterInput } from './schemas/register.schema.js'
import {
  resetPasswordSchema,
  sendResetPasswordCodeSchema,
  type ResetPasswordInput,
  type SendResetPasswordCodeInput,
} from './schemas/reset-password.schema.js'
import {
  sendRegisterCodeSchema,
  type SendRegisterCodeInput,
} from './schemas/send-register-code.schema.js'
import { TokenService } from './services/token.service.js'
import type { AuthenticatedRequest, AuthUserContext } from './types/auth-user.type.js'
import { extractBearerToken } from './utils/bearer-token.util.js'
import { getClientIp } from './utils/client-ip.util.js'
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
 * 登录限流维度：IP + 登录标识，防止对同一账号暴力破解。
 *
 * 登录标识（identifier）可以是邮箱、学号或工号，统一转小写后参与限流，
 * 避免同一邮箱因大小写差异绕过计数。
 * 此时 body 尚未经过 Zod 校验，只做防御性读取。
 */
function loginRateLimitKey(request: Request): string {
  const body = request.body as { identifier?: unknown } | undefined
  const identifier =
    typeof body?.identifier === 'string' ? body.identifier.trim().toLowerCase() : ''

  return `login:${request.ip ?? 'unknown'}:${identifier}`
}

/** 换绑密码验证限流：优先按已认证用户，其次按 IP */
function emailChangeRateLimitKey(request: Request): string {
  const userId = (request as AuthenticatedRequest).user?.userId

  return `email-change:${userId ?? request.ip ?? 'unknown'}`
}

@ApiTags('Auth - 身份认证')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly tokenService: TokenService,
    private readonly emailCodeService: EmailCodeService,
    private readonly emailChangeService: EmailChangeService,
  ) {}

  /**
   * 发送注册邮箱验证码
   *
   * - 验证码 6 位数字，有效期默认 120 秒
   * - 同一邮箱 60 秒内只能发送一次，单邮箱每小时 5 次，单 IP 每小时 20 次
   * - 邮箱已注册时同样返回成功结构（不发信），避免账号枚举
   * - Redis 或 SMTP 不可用时返回 503，绝不降级放行
   */
  @Post('email-codes/register')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimitGuard)
  @RateLimit({ windowMs: 60_000, limit: 10 })
  @ApiOperation({
    summary: '发送注册邮箱验证码',
    description:
      '邮箱已注册时同样返回成功结构但不会发送邮件，用于避免账号枚举。真实的发送频率由 Redis 强制限制。',
  })
  @ApiSuccessResponse({
    description: '验证码已受理（不代表邮箱一定可注册）',
    dataSchema: sendEmailCodeResultSchema,
  })
  @ApiErrorResponse({
    status: 400,
    code: 40001,
    message: '请求参数校验失败',
    dataSchema: validationIssuesSchema,
  })
  @ApiErrorResponse({ status: 429, code: 42900, message: '验证码发送过于频繁，请稍后再试' })
  @ApiErrorResponse({
    status: 503,
    code: 50300,
    message: '验证码或邮件服务暂时不可用，请稍后重试',
  })
  async sendRegisterCode(
    @Body({ schema: sendRegisterCodeSchema }) body: SendRegisterCodeInput,
    @Req() request: Request,
  ): Promise<ApiSuccessResult<SendEmailCodeResult>> {
    const result = await this.emailCodeService.requestRegisterCode({
      email: body.email,
      ip: getClientIp(request),
    })

    return new ApiSuccessResult(result, '如果该邮箱可以注册，验证码将发送至邮箱')
  }

  /**
   * 学生注册
   *
   * 必须携带邮箱验证码：Redis 原子校验并消费成功后才创建账号。
   * 默认分配 STUDENT 角色，不接受客户端指定角色。
   */
  @Post('register')
  @UseGuards(RateLimitGuard)
  @RateLimit({ windowMs: 10 * 60_000, limit: 10 })
  @ApiOperation({
    summary: '学生注册（需要邮箱验证码，默认 STUDENT 角色）',
    description:
      '请先调用 POST /api/auth/email-codes/register 获取验证码。请求体使用 realName（真实姓名，2-50 个字符，只允许中文、英文字母、间隔号与空格），不使用昵称或显示名。验证码一次性有效，校验与消费在同一次 Redis 原子操作中完成。',
  })
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
  @ApiErrorResponse({ status: 400, code: 40011, message: '邮箱验证码不正确' })
  @ApiErrorResponse({ status: 400, code: 40012, message: '验证码已过期，请重新获取' })
  @ApiErrorResponse({ status: 400, code: 40013, message: '验证码错误次数过多，请重新获取' })
  @ApiErrorResponse({ status: 409, code: 40900, message: '该邮箱已被注册' })
  @ApiErrorResponse({ status: 429, code: 42900, message: '请求过于频繁，请稍后再试' })
  @ApiErrorResponse({
    status: 503,
    code: 50300,
    message: '验证码服务暂时不可用，请稍后重试',
  })
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
   * 发送修改/重置密码邮箱验证码
   *
   * - 验证码 6 位数字，有效期默认 120 秒
   * - 同一邮箱 60 秒内只能发送一次，单邮箱每小时 5 次，单 IP 每小时 20 次
   * - 邮箱不存在或账号被禁用时同样返回成功结构（不发信），避免账号枚举
   */
  @Post('email-codes/reset-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimitGuard)
  @RateLimit({ windowMs: 60_000, limit: 10 })
  @ApiOperation({
    summary: '发送重置/修改密码邮箱验证码',
    description:
      '同一邮箱 60 秒内只能发送一次。邮箱不存在时同样返回成功结构但不会发送邮件，用于避免账号枚举。',
  })
  @ApiSuccessResponse({
    description: '验证码已受理',
    dataSchema: sendEmailCodeResultSchema,
  })
  @ApiErrorResponse({
    status: 400,
    code: 40001,
    message: '请求参数校验失败',
    dataSchema: validationIssuesSchema,
  })
  @ApiErrorResponse({ status: 429, code: 42900, message: '验证码发送过于频繁，请稍后再试' })
  @ApiErrorResponse({
    status: 503,
    code: 50300,
    message: '验证码或邮件服务暂时不可用，请稍后重试',
  })
  async sendResetPasswordCode(
    @Body({ schema: sendResetPasswordCodeSchema }) body: SendResetPasswordCodeInput,
    @Req() request: Request,
  ): Promise<ApiSuccessResult<SendEmailCodeResult>> {
    const result = await this.emailCodeService.requestPasswordResetCode({
      email: body.email,
      ip: getClientIp(request),
    })

    return new ApiSuccessResult(result, '如果该邮箱已注册，验证码将发送至邮箱')
  }

  /**
   * 邮箱验证码修改/重置密码
   *
   * 必须携带邮箱验证码，Redis 原子校验并消费成功后更新密码，并吊销所有活跃会话。
   */
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimitGuard)
  @RateLimit({ windowMs: 10 * 60_000, limit: 10 })
  @ApiOperation({
    summary: '使用邮箱验证码修改/重置密码',
    description:
      '校验并消费邮箱验证码后更新用户密码，并吊销该用户现有的全部登录会话。可用于个人中心修改密码或忘记密码重置。',
  })
  @ApiSuccessResponse({
    description: '密码修改成功',
    dataSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: '密码修改成功，请使用新密码重新登录' },
      },
    },
  })
  @ApiErrorResponse({
    status: 400,
    code: 40001,
    message: '请求参数校验失败',
    dataSchema: validationIssuesSchema,
  })
  @ApiErrorResponse({ status: 400, code: 40011, message: '邮箱验证码不正确' })
  @ApiErrorResponse({ status: 400, code: 40012, message: '验证码已过期，请重新获取' })
  @ApiErrorResponse({ status: 400, code: 40013, message: '验证码错误次数过多，请重新获取' })
  @ApiErrorResponse({ status: 403, code: 40300, message: '账号已被禁用或锁定' })
  @ApiErrorResponse({ status: 429, code: 42900, message: '请求过于频繁，请稍后再试' })
  async resetPassword(
    @Body({ schema: resetPasswordSchema }) body: ResetPasswordInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ message: string }> {
    await this.authService.resetPassword(body, getRequestMeta(request))
    this.clearRefreshCookie(response)

    return { message: '密码修改成功，请使用新密码重新登录' }
  }

  /** 换绑第一步：验证当前密码，换取短期令牌 */
  @Post('email-change/verify-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AccessTokenGuard, RateLimitGuard)
  @RateLimit({ windowMs: 10 * 60_000, limit: 8, keyBy: emailChangeRateLimitKey })
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: '验证当前密码（更换绑定邮箱第一步）',
    description: '验证通过后返回 10 分钟内有效的 changeToken，后续解绑、发码与绑定都必须携带。',
  })
  @ApiSuccessResponse({
    description: '密码验证通过',
    dataSchema: {
      type: 'object',
      required: ['changeToken', 'expiresIn'],
      properties: {
        changeToken: { type: 'string', description: '换绑流程令牌' },
        expiresIn: { type: 'integer', description: '令牌有效期（秒）', example: 600 },
      },
    },
  })
  @ApiErrorResponse({ status: 401, code: 40100, message: '当前密码不正确' })
  @ApiErrorResponse({ status: 429, code: 42900, message: '验证过于频繁，请稍后再试' })
  async verifyEmailChangePassword(
    @Body({ schema: verifyEmailChangePasswordSchema }) body: VerifyEmailChangePasswordInput,
    @CurrentUser() authUser: AuthUserContext,
  ): Promise<VerifyEmailChangePasswordResult> {
    return this.emailChangeService.verifyPassword(authUser.userId, body.password)
  }

  /** 换绑第二步：解绑原邮箱 */
  @Post('email-change/unbind')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AccessTokenGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: '解绑原邮箱（更换绑定邮箱第二步）' })
  @ApiSuccessResponse({
    description: '原邮箱已解绑',
    dataSchema: {
      type: 'object',
      required: ['email'],
      properties: { email: { type: 'string', nullable: true, example: null } },
    },
  })
  @ApiErrorResponse({ status: 400, code: 40014, message: '身份验证已过期，请重新验证当前密码' })
  @ApiErrorResponse({ status: 400, code: 40015, message: '身份验证令牌无效' })
  async unbindEmail(
    @Body({ schema: unbindEmailSchema }) body: UnbindEmailInput,
    @CurrentUser() authUser: AuthUserContext,
  ): Promise<{ email: null }> {
    return this.emailChangeService.unbind(authUser.userId, body.changeToken)
  }

  /** 换绑第三步：向新邮箱发送验证码 */
  @Post('email-codes/bind-email')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AccessTokenGuard, RateLimitGuard)
  @RateLimit({ windowMs: 60_000, limit: 10 })
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: '发送换绑邮箱验证码（更换绑定邮箱第三步）',
    description: '必须先完成密码验证与解绑。验证码仅发送至新邮箱，错误次数与频率由 Redis 限制。',
  })
  @ApiSuccessResponse({ description: '验证码已受理', dataSchema: sendEmailCodeResultSchema })
  @ApiErrorResponse({ status: 409, code: 40900, message: '该邮箱已被其他账号使用' })
  @ApiErrorResponse({ status: 429, code: 42900, message: '验证码发送过于频繁，请稍后再试' })
  @ApiErrorResponse({ status: 503, code: 50300, message: '验证码或邮件服务暂时不可用' })
  async sendBindEmailCode(
    @Body({ schema: sendBindEmailCodeSchema }) body: SendBindEmailCodeInput,
    @Req() request: Request,
    @CurrentUser() authUser: AuthUserContext,
  ): Promise<SendEmailCodeResult> {
    return this.emailChangeService.requestBindCode(
      authUser.userId,
      body.changeToken,
      body.email,
      getClientIp(request),
    )
  }

  /** 换绑第四步：校验验证码并绑定新邮箱 */
  @Post('email-change/bind')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AccessTokenGuard, RateLimitGuard)
  @RateLimit({ windowMs: 10 * 60_000, limit: 10 })
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: '校验验证码并绑定新邮箱（更换绑定邮箱第四步）',
    description: '验证码一次性有效，绑定成功后返回最新的当前用户信息。',
  })
  @ApiSuccessResponse({ description: '新邮箱绑定成功', dataSchema: authUserSchema })
  @ApiErrorResponse({ status: 400, code: 40011, message: '邮箱验证码不正确' })
  @ApiErrorResponse({ status: 400, code: 40012, message: '验证码已过期，请重新获取' })
  @ApiErrorResponse({ status: 400, code: 40013, message: '验证码错误次数过多，请重新获取' })
  @ApiErrorResponse({ status: 409, code: 40900, message: '该邮箱已被其他账号使用' })
  async bindEmail(
    @Body({ schema: bindEmailSchema }) body: BindEmailInput,
    @CurrentUser() authUser: AuthUserContext,
  ): Promise<AuthUser> {
    return this.emailChangeService.bind(
      authUser.userId,
      body.changeToken,
      body.email,
      body.emailCode,
    )
  }

  /**
   * 账号密码登录
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimitGuard)
  @RateLimit({ windowMs: 60_000, limit: 5, keyBy: loginRateLimitKey })
  @ApiOperation({
    summary: '账号密码登录（邮箱 / 学号 / 工号三选一）',
    description:
      '请求体为 { identifier, password }：identifier 可以是邮箱（含 @）、学号或工号，三者任选其一，' +
      '示例：{ "identifier": "2021001001", "password": "********" }。' +
      '账号不存在与密码错误返回同一错误信息，避免账号枚举。',
  })
  @ApiSuccessResponse({ description: '登录成功', dataSchema: authResultSchema })
  @ApiErrorResponse({
    status: 400,
    code: 40001,
    message: '请求参数校验失败',
    dataSchema: validationIssuesSchema,
  })
  @ApiErrorResponse({ status: 401, code: 40100, message: '账号或密码错误' })
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
