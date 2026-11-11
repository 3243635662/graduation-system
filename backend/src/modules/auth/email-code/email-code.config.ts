import { DEFAULT_EMAIL_CODE_KEY_PREFIX } from './email-code.keys.js'

/** 验证码相关配置（全部来自环境变量） */
export interface EmailCodeConfig {
  /** HMAC 密钥，独立于 JWT / Redis / SMTP 密码 */
  pepper: string
  /** 验证码有效期（秒） */
  codeTtlSeconds: number
  /** 重新发送冷却（秒） */
  resendIntervalSeconds: number
  /** 单个验证码允许的最大错误次数 */
  maxAttempts: number
  /** 单邮箱每小时发送上限 */
  maxSendsPerEmailPerHour: number
  /** 单 IP 每小时发送上限 */
  maxSendsPerIpHour: number
  /** Redis Key 用途前缀 */
  keyPrefix: string
}

export class EmailCodeConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EmailCodeConfigError'
  }
}

interface RangeOptions {
  name: string
  min: number
  max: number
  fallback: number
}

function parseRange(raw: string | undefined, options: RangeOptions): number {
  const { name, min, max, fallback } = options

  if (raw === undefined || raw.trim() === '') return fallback

  const value = Number(raw.trim())

  // 拒绝 0 秒 TTL、无限发送等非法配置
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new EmailCodeConfigError(`${name} 取值非法：必须是 ${min}～${max} 之间的整数`)
  }

  return value
}

/** OTP_PEPPER 最小长度：太短的密钥可被暴力枚举 */
const MIN_PEPPER_LENGTH = 16

/**
 * 读取并校验验证码配置。
 *
 * 配置非法时抛错让应用启动失败，而不是带着 0 秒 TTL / 无限发送运行。
 */
export function loadEmailCodeConfig(env: NodeJS.ProcessEnv = process.env): EmailCodeConfig {
  const pepper = env['OTP_PEPPER']?.trim() ?? ''

  if (!pepper) {
    throw new EmailCodeConfigError('缺少 OTP_PEPPER 环境变量')
  }

  if (pepper.length < MIN_PEPPER_LENGTH) {
    throw new EmailCodeConfigError(`OTP_PEPPER 长度至少 ${MIN_PEPPER_LENGTH} 个字符`)
  }

  return {
    pepper,
    codeTtlSeconds: parseRange(env['EMAIL_CODE_TTL_SECONDS'], {
      name: 'EMAIL_CODE_TTL_SECONDS',
      min: 30,
      max: 900,
      fallback: 120,
    }),
    resendIntervalSeconds: parseRange(env['EMAIL_CODE_RESEND_INTERVAL_SECONDS'], {
      name: 'EMAIL_CODE_RESEND_INTERVAL_SECONDS',
      min: 10,
      max: 600,
      fallback: 60,
    }),
    maxAttempts: parseRange(env['EMAIL_CODE_MAX_ATTEMPTS'], {
      name: 'EMAIL_CODE_MAX_ATTEMPTS',
      min: 1,
      max: 10,
      fallback: 5,
    }),
    maxSendsPerEmailPerHour: parseRange(env['EMAIL_CODE_MAX_SENDS_PER_HOUR'], {
      name: 'EMAIL_CODE_MAX_SENDS_PER_HOUR',
      min: 1,
      max: 50,
      fallback: 5,
    }),
    maxSendsPerIpHour: parseRange(env['EMAIL_CODE_MAX_SENDS_PER_IP_HOUR'], {
      name: 'EMAIL_CODE_MAX_SENDS_PER_IP_HOUR',
      min: 1,
      max: 500,
      fallback: 20,
    }),
    keyPrefix: env['EMAIL_CODE_KEY_PREFIX']?.trim() || DEFAULT_EMAIL_CODE_KEY_PREFIX,
  }
}
