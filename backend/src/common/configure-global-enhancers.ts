import {
  BadRequestException,
  StandardSchemaValidationPipe,
  type INestApplication,
} from '@nestjs/common'

import { GlobalExceptionFilter } from './filters/global-exception.filter.js'
import { ResponseInterceptor } from './interceptors/response.interceptor.js'
import { requestContextMiddleware } from './request-context/request-context.js'

/**
 * 统一注册全局请求处理组件
 *
 * 1. 请求追踪上下文（requestId）
 * 2. 请求参数校验
 * 3. 成功响应包装
 * 4. 全局异常处理
 */
export function configureGlobalEnhancers(app: INestApplication): void {
  // requestId 中间件必须最先注册：后续校验、业务与审计都依赖该上下文
  app.use(requestContextMiddleware)

  // 全局 Zod / Standard Schema 校验
  app.useGlobalPipes(
    new StandardSchemaValidationPipe({
      exceptionFactory: (issues) =>
        new BadRequestException({
          code: 40001,
          data: issues.map((issue) => ({
            path:
              issue.path
                ?.map((segment) => (typeof segment === 'object' ? segment.key : segment))
                .join('.') ?? '',
            message: issue.message,
          })),
          message: '请求参数校验失败',
        }),
    }),
  )

  // 全局成功响应包装
  app.useGlobalInterceptors(new ResponseInterceptor())

  // 全局异常处理
  app.useGlobalFilters(new GlobalExceptionFilter())
}
