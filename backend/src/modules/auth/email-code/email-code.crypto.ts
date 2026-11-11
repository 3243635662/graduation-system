import { createHmac, randomInt } from 'node:crypto'

/** 验证码业务用途前缀：注册与未来找回密码等场景互不复用 */
export const REGISTER_CODE_SCOPE = 'register-code'

/** 验证码长度固定为 6 位 */
export const CODE_LENGTH = 6

/** 把数字补齐成六位字符串（前导零必须保留，否则 000042 ≠ 42） */
export function toSixDigitCode(value: number): string {
  return value.toString().padStart(CODE_LENGTH, '0')
}

/**
 * 生成六位数字验证码（字符串，保留前导零）。
 *
 * 使用 crypto.randomInt 而不是 Math.random，避免可预测的验证码。
 */
export function generateSixDigitCode(): string {
  return toSixDigitCode(randomInt(0, 10 ** CODE_LENGTH))
}

/** 邮箱规范化：与 Zod Schema 保持一致（trim + 小写） */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * 带 Pepper 的 HMAC-SHA256。
 *
 * 六位验证码的取值空间只有 100 万，普通 SHA-256 可被离线枚举，
 * 因此必须用服务端密钥做 HMAC，且 Pepper 独立于 JWT/Redis/SMTP 密钥。
 */
export function hmacHex(pepper: string, payload: string): string {
  return createHmac('sha256', pepper).update(payload).digest('hex')
}

/** 计算邮箱/IP 的标识哈希，避免把原始值写进 Redis Key */
export function hashIdentifier(pepper: string, scope: 'email' | 'ip', value: string): string {
  return hmacHex(pepper, `${scope}:${value}`)
}

/** 计算验证码摘要：验证码 + 业务用途 + 规范化邮箱 */
export function hashRegisterCode(pepper: string, email: string, code: string): string {
  return hmacHex(pepper, `${REGISTER_CODE_SCOPE}:${normalizeEmail(email)}:${code}`)
}
