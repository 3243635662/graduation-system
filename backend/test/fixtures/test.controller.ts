import type { PaginationQuery } from '@graduation/shared'
import { BadRequestException, Controller, Get } from '@nestjs/common'

import { ApiErrorResponse } from '../../src/common/decorators/api-error-response.decorator.js'
import { ApiPaginatedSuccessResponse } from '../../src/common/decorators/api-paginated-success-response.decorator.js'
import { ApiSuccessResponse } from '../../src/common/decorators/api-success-response.decorator.js'
import { PaginatedQuery } from '../../src/common/decorators/paginated-query.decorator.js'

/**
 * 构造模拟 Prisma 已知请求错误。
 *
 * 只测试全局异常过滤器的映射逻辑，不访问真实数据库。
 */
function createPrismaError(code: string): Error & { code: string } {
  const error = new Error(`Simulated Prisma error: ${code}`) as Error & { code: string }

  error.name = 'PrismaClientKnownRequestError'
  error.code = code

  return error
}

@Controller('_test')
export class TestController {
  /**
   * 测试统一成功响应
   */
  @Get('success')
  getSuccess() {
    return {
      id: 'test-001',
      name: '测试用户',
    }
  }

  /**
   * 测试分页参数转换和默认值
   */
  @Get('pagination')
  getPagination(@PaginatedQuery() query: PaginationQuery): PaginationQuery {
    return query
  }

  /**
   * 测试普通 HTTP 异常
   */
  @Get('bad-request')
  getBadRequest(): never {
    throw new BadRequestException('测试请求错误')
  }

  /**
   * 测试 Prisma 唯一约束冲突 P2002
   */
  @Get('prisma/p2002')
  throwP2002(): never {
    throw createPrismaError('P2002')
  }

  /**
   * 测试 Prisma 外键约束冲突 P2003
   */
  @Get('prisma/p2003')
  throwP2003(): never {
    throw createPrismaError('P2003')
  }

  /**
   * 测试 Prisma 记录不存在 P2025
   */
  @Get('prisma/p2025')
  throwP2025(): never {
    throw createPrismaError('P2025')
  }

  /**
   * Swagger 普通成功响应测试
   */
  @ApiSuccessResponse({
    description: '测试普通成功响应',
    dataSchema: {
      type: 'object',
      required: ['id', 'name'],
      properties: {
        id: {
          type: 'string',
          example: 'test-001',
        },
        name: {
          type: 'string',
          example: '测试用户',
        },
      },
    },
  })
  @Get('swagger/success')
  swaggerSuccess() {
    return {
      id: 'test-001',
      name: '测试用户',
    }
  }

  /**
   * Swagger 错误响应测试
   */
  @ApiErrorResponse({
    status: 400,
    code: 40001,
    message: '请求参数校验失败',
    dataSchema: {
      type: 'array',
      items: {
        type: 'object',
        required: ['path', 'message'],
        properties: {
          path: {
            type: 'string',
            example: 'page',
          },
          message: {
            type: 'string',
            example: '页码必须大于等于 1',
          },
        },
      },
    },
  })
  @Get('swagger/error')
  swaggerError(): never {
    throw new BadRequestException('测试参数校验错误')
  }

  /**
   * Swagger 分页成功响应测试
   */
  @ApiPaginatedSuccessResponse({
    description: '测试分页成功响应',
    itemSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: {
          type: 'string',
          example: 'user-001',
        },
      },
    },
  })
  @Get('swagger/paginated')
  swaggerPaginated() {
    return {
      list: [{ id: 'user-001' }],
      total: 1,
    }
  }
}
