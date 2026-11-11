import type { ApiResponse } from '@graduation/shared'
import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common'
import type { Observable } from 'rxjs'
import { map } from 'rxjs/operators'

import { ApiSuccessResult } from './api-success-result.js'

/**
 * 全局响应拦截器
 *
 * 将 Controller 返回的业务数据统一包装为 ApiResponse。
 * 若返回 ApiSuccessResult，则使用其自带 message。
 */
@Injectable()
export class ResponseInterceptor implements NestInterceptor<unknown, ApiResponse<unknown>> {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<ApiResponse<unknown>> {
    return next.handle().pipe(
      map((result: unknown): ApiResponse<unknown> => {
        if (result instanceof ApiSuccessResult) {
          return { code: 0, data: result.data ?? null, message: result.message }
        }

        return {
          code: 0,
          data: result ?? null,
          message: '请求成功',
        }
      }),
    )
  }
}
