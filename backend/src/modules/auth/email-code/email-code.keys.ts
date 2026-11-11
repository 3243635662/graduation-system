/**
 * Redis Key 规范
 *
 * 统一以用途前缀开头，并用 HMAC 后的 emailHash / ipHash 替代原始邮箱与 IP，
 * 避免 Redis 中直接暴露个人信息，也避免 Key 被特殊字符污染。
 */
export interface EmailCodeKeys {
  /** 验证码记录（Hash：digest / attempts） */
  code: (emailHash: string) => string
  /** 发送冷却（String，TTL = resend interval） */
  cooldown: (emailHash: string) => string
  /** 单邮箱每小时发送计数 */
  hourly: (emailHash: string) => string
  /** 单 IP 每小时发送计数 */
  ipHourly: (ipHash: string) => string
}

/** 默认用途前缀，测试可用 EMAIL_CODE_KEY_PREFIX 覆盖为独立前缀 */
export const DEFAULT_EMAIL_CODE_KEY_PREFIX = 'auth:email-code:register'

export function buildEmailCodeKeys(prefix: string = DEFAULT_EMAIL_CODE_KEY_PREFIX): EmailCodeKeys {
  const base = prefix.replace(/:+$/, '')

  return {
    code: (emailHash) => `${base}:${emailHash}`,
    cooldown: (emailHash) => `${base}:cooldown:${emailHash}`,
    hourly: (emailHash) => `${base}:hourly:${emailHash}`,
    ipHourly: (ipHash) => `${base}:ip-hourly:${ipHash}`,
  }
}
