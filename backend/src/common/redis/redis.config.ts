import type { RedisConnectionConfig } from './redis.constants.js'

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 6379
const DEFAULT_DATABASE = 0
const DEFAULT_CONNECT_TIMEOUT_MS = 5_000

interface IntegerOptions {
  name: string
  min: number
  max: number
  fallback: number
}

function parseInteger(raw: string | undefined, options: IntegerOptions): number {
  const { name, min, max, fallback } = options

  if (raw === undefined || raw.trim() === '') return fallback

  const value = Number(raw.trim())

  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} 取值非法：必须是 ${min}～${max} 之间的整数`)
  }

  return value
}

/**
 * 从环境变量读取 Redis 连接配置。
 *
 * 注意：宿主机端口与容器端口不同。NestJS 运行在宿主机时使用映射端口（本项目为 6380），
 * 只有 NestJS 也进入 Docker 网络时才应改用 redis:6379。
 */
export function loadRedisConfig(env: NodeJS.ProcessEnv = process.env): RedisConnectionConfig {
  const host = (env['REDIS_HOST'] ?? DEFAULT_HOST).trim()

  if (!host) {
    throw new Error('REDIS_HOST 不能为空')
  }

  const username = env['REDIS_USERNAME']?.trim()
  const password = env['REDIS_PASSWORD']

  return {
    host,
    port: parseInteger(env['REDIS_PORT'], {
      name: 'REDIS_PORT',
      min: 1,
      max: 65_535,
      fallback: DEFAULT_PORT,
    }),
    username: username ? username : undefined,
    // 密码原样使用：前后空格也可能是密码的一部分，不做 trim
    password: password ? password : undefined,
    database: parseInteger(env['REDIS_DB'], {
      name: 'REDIS_DB',
      min: 0,
      max: 15,
      fallback: DEFAULT_DATABASE,
    }),
    connectTimeoutMs: DEFAULT_CONNECT_TIMEOUT_MS,
  }
}
