import { API_PREFIX, DEFAULT_API_TIMEOUT } from '@graduation/shared'
import z from 'zod'

export const EnvSchema = z.object({
  // 留空表示走同源相对路径，由 vite.config.ts 的 /api 代理转发到后端
  VITE_SERVER_API_URL: z
    .url()
    .optional()
    .transform((value) => value ?? ''),
  VITE_SERVER_API_PREFIX: z.string().default(`/${API_PREFIX}`),
  VITE_SERVER_API_TIMEOUT: z.coerce.number().default(DEFAULT_API_TIMEOUT),
})

export type env = z.infer<typeof EnvSchema>
