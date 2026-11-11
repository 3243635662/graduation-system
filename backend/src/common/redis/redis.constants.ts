/**
 * Redis 客户端注入令牌
 *
 * 使用 Symbol 避免与其他 Provider 的字符串令牌冲突。
 */
export const REDIS_CLIENT = Symbol('REDIS_CLIENT')

/** Redis 连接配置（全部来自环境变量） */
export interface RedisConnectionConfig {
  host: string
  port: number
  username?: string
  password?: string
  database: number
  connectTimeoutMs: number
}
