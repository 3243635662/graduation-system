/**
 * Redis Lua 脚本
 *
 * 所有「读后写」的逻辑都放进脚本里，由 Redis 单线程原子执行，
 * 从根上避免并发请求同时读到同一个验证码都判定成功的竞态。
 */

/** 写入验证码摘要并设置 TTL（重置 attempts） */
export const SET_CODE_SCRIPT = `
redis.call('HSET', KEYS[1], 'digest', ARGV[1], 'attempts', 0)
redis.call('EXPIRE', KEYS[1], ARGV[2])
return 1
`

/**
 * 自增计数器，并在首次创建时设置 TTL。
 *
 * INCR + EXPIRE 分两步会产生「计数器永不过期」的竞态，因此必须原子完成。
 */
export const INCR_WITH_TTL_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return count
`

/**
 * 原子验证并消费验证码。
 *
 * 返回值：
 * - SUCCESS   验证通过，Key 已删除（一次性消费）
 * - EXPIRED   记录不存在（未发送或已过期）
 * - INVALID   验证码错误，attempts 已 +1
 * - EXHAUSTED 错误次数达到上限，Key 已删除
 *
 * ARGV[1] = 提交验证码的 HMAC 摘要
 * ARGV[2] = 最大错误次数
 */
export const VERIFY_AND_CONSUME_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then
  return 'EXPIRED'
end
local digest = redis.call('HGET', KEYS[1], 'digest')
if not digest then
  redis.call('DEL', KEYS[1])
  return 'EXPIRED'
end
if digest == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return 'SUCCESS'
end
local attempts = redis.call('HINCRBY', KEYS[1], 'attempts', 1)
if attempts >= tonumber(ARGV[2]) then
  redis.call('DEL', KEYS[1])
  return 'EXHAUSTED'
end
return 'INVALID'
`
