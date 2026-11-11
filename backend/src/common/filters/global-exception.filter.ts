import type { ApiResponse } from '@graduation/shared'
import { Catch, HttpException, HttpStatus, Logger } from '@nestjs/common'
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common'
import type { Request, Response } from 'express'

interface NormalizedException {
  status: number
  body: ApiResponse<unknown>
}

/**
 * 判断是否为普通对象
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * 将 HTTP 状态码映射为业务状态码
 */
function getBusinessCode(status: number): number {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 40000
    case HttpStatus.UNAUTHORIZED:
      return 40100
    case HttpStatus.FORBIDDEN:
      return 40300
    case HttpStatus.NOT_FOUND:
      return 40400
    case HttpStatus.CONFLICT:
      return 40900
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return 42200
    case HttpStatus.TOO_MANY_REQUESTS:
      return 42900
    default:
      return 50000
  }
}

/**
 * 提取异常消息
 */
function getMessage(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    return value
  }

  if (Array.isArray(value)) {
    const messages = value.filter((item): item is string => typeof item === 'string')

    return messages.length > 0 ? messages.join('；') : null
  }

  return null
}

/**
 * 处理 Prisma 常见数据库异常
 */
function getPrismaException(exception: unknown): NormalizedException | null {
  if (!isRecord(exception) || typeof exception.code !== 'string') {
    return null
  }

  switch (exception.code) {
    case 'P2002':
      return {
        status: HttpStatus.CONFLICT,
        body: {
          code: 40900,
          data: null,
          message: '数据已存在，不能重复创建',
        },
      }

    case 'P2003':
      return {
        status: HttpStatus.CONFLICT,
        body: {
          code: 40900,
          data: null,
          message: '关联数据不存在或违反关联约束',
        },
      }

    case 'P2025':
      return {
        status: HttpStatus.NOT_FOUND,
        body: {
          code: 40400,
          data: null,
          message: '请求的数据不存在',
        },
      }

    default:
      return null
  }
}

/**
 * 全局异常过滤器
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name)

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp()
    const request = context.getRequest<Request>()
    const response = context.getResponse<Response>()

    const normalized = this.normalizeException(exception)

    // 服务器内部异常记录完整日志，但不向客户端泄露内部信息
    if (normalized.status >= 500) {
      this.logger.error(
        `${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      )
    }

    response.status(normalized.status).json(normalized.body)
  }

  /**
   * 统一转换异常响应
   */
  private normalizeException(exception: unknown): NormalizedException {
    // 1. 优先处理常见 Prisma 异常
    const prismaException = getPrismaException(exception)

    if (prismaException) {
      return prismaException
    }

    // 2. 处理 NestJS HTTP 异常
    if (exception instanceof HttpException) {
      const status = exception.getStatus()

      // 5xx 错误不向客户端暴露内部异常信息
      if (status >= 500) {
        /*
         * 例外：503 是业务主动抛出的「依赖不可用」（Redis / SMTP）。
         * 这类响应体由我们自己编写，只说明可公开的故障类型，
         * 只要带显式 code 就透传，其余 5xx 一律脱敏。
         */
        const serviceUnavailable = exception.getResponse()

        if (
          status === HttpStatus.SERVICE_UNAVAILABLE &&
          isRecord(serviceUnavailable) &&
          typeof serviceUnavailable.code === 'number'
        ) {
          return {
            status,
            body: {
              code: serviceUnavailable.code,
              data: serviceUnavailable.data ?? null,
              message: getMessage(serviceUnavailable.message) ?? '服务暂时不可用，请稍后重试',
            },
          }
        }

        return {
          status,
          body: {
            code: 50000,
            data: null,
            message: '服务器内部错误',
          },
        }
      }

      const exceptionResponse = exception.getResponse()

      // 兼容自定义 HTTP 异常响应
      if (isRecord(exceptionResponse)) {
        const data =
          'data' in exceptionResponse
            ? exceptionResponse.data
            : 'result' in exceptionResponse
              ? exceptionResponse.result
              : null

        return {
          status,
          body: {
            code:
              typeof exceptionResponse.code === 'number'
                ? exceptionResponse.code
                : getBusinessCode(status),
            data: data ?? null,
            message: getMessage(exceptionResponse.message) ?? '请求处理失败',
          },
        }
      }

      return {
        status,
        body: {
          code: getBusinessCode(status),
          data: null,
          message: getMessage(exceptionResponse) ?? '请求处理失败',
        },
      }
    }

    // 3. 未知异常统一处理
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        code: 50000,
        data: null,
        message: '服务器内部错误',
      },
    }
  }
}
