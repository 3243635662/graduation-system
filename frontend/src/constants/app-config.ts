import { env } from '@/utils/env'
import { API_PREFIX, DEFAULT_API_TIMEOUT } from '@graduation/shared'

export const API_BASE_URL =
  `${env.VITE_SERVER_API_URL}${env.VITE_SERVER_API_PREFIX ?? `/${API_PREFIX}`}` as const

export const API_TIMEOUT = env.VITE_SERVER_API_TIMEOUT ?? DEFAULT_API_TIMEOUT
