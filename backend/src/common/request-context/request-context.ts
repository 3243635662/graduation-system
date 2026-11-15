import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'

import type { NextFunction, Request, Response } from 'express'

/**
 * 单次请求的追踪上下文
 *
 * 只保存可以安全用于日志与审计的追踪标识，不保存用户身份或业务数据。
 */
export interface RequestContextStore {
  requestId: string
}

/** 合法的外部 requestId：长度 8~64，只允许常见可见字符，避免日志注入 */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,64}$/

const storage = new AsyncLocalStorage<RequestContextStore>()

/** 在指定上下文中执行；测试可直接使用，业务代码应通过 HTTP 中间件进入 */
export function runWithRequestContext<T>(store: RequestContextStore, callback: () => T): T {
  return storage.run(store, callback)
}

/** 当前请求上下文；非请求场景（脚本、测试）返回 undefined */
export function getRequestContext(): RequestContextStore | undefined {
  return storage.getStore()
}

/** 当前请求的 requestId；无上下文时返回 null */
export function getRequestId(): string | null {
  return storage.getStore()?.requestId ?? null
}

/**
 * requestId 中间件
 *
 * 1. 优先沿用网关或客户端传入的合法 X-Request-Id；
 * 2. 缺省或非法时生成 UUID，保证审计记录始终有可追踪标识；
 * 3. 同一 requestId 回写响应头，便于把审计记录与访问日志对齐。
 */
export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers['x-request-id']
  const candidate = Array.isArray(incoming) ? incoming[0] : incoming
  const requestId =
    typeof candidate === 'string' && REQUEST_ID_PATTERN.test(candidate) ? candidate : randomUUID()

  res.setHeader('X-Request-Id', requestId)

  runWithRequestContext({ requestId }, () => next())
}
