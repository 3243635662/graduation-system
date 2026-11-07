import type { env as Env } from '@/validators/env.validator'
import { EnvSchema } from '@/validators/env.validator'
import { z } from 'zod'

/**
 * Safe values used when the environment is invalid, so the app can still boot
 * and surface `envError` instead of crashing in `constants/app-config.ts`.
 */
const FALLBACK_ENV: Env = EnvSchema.parse({})

const result = EnvSchema.safeParse(import.meta.env)

export const envError = result.success ? null : result.error

if (envError) {
  console.error('❌ Invalid env')
  console.error(z.flattenError(envError))
}

export const env: Env = result.success ? result.data : FALLBACK_ENV
