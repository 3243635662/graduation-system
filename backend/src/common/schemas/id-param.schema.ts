import { z } from 'zod'

/**
 * 统一的路径参数：UUID 格式的资源 ID
 *
 * 配合 @Param({ schema }) 与全局 StandardSchemaValidationPipe 使用，
 * 校验失败时由全局异常过滤器返回 400 / code 40001。
 */
export const idParamSchema = z.object({
  id: z.uuid(),
})

export type IdParam = z.infer<typeof idParamSchema>
