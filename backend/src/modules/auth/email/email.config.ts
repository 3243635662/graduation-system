/**
 * yeah.net SMTP 配置
 *
 * smtp.yeah.net:465 + secure=true（SSL）。密码必须是邮箱客户端授权码，
 * 不是邮箱登录密码。
 */
export interface SmtpConfig {
  host: string
  port: number
  secure: boolean
  user: string
  pass: string
  from: string
  fromName: string
}

export const SMTP_CONFIG_ERROR_MESSAGE = '邮件服务配置不完整，请联系管理员'

export class SmtpConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SmtpConfigError'
  }
}

const DEFAULT_HOST = 'smtp.yeah.net'
const DEFAULT_PORT = 465
const DEFAULT_FROM_NAME = 'Graduation Management System'

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === '') return fallback

  const value = raw.trim().toLowerCase()

  if (['true', '1', 'yes'].includes(value)) return true
  if (['false', '0', 'no'].includes(value)) return false

  throw new SmtpConfigError('SMTP_SECURE 只能是 true 或 false')
}

/**
 * 读取并校验 SMTP 配置。
 *
 * 错误信息只说明缺哪个变量，绝不回显密码或授权码。
 */
export function loadSmtpConfig(env: NodeJS.ProcessEnv = process.env): SmtpConfig {
  const host = (env['SMTP_HOST'] ?? DEFAULT_HOST).trim()
  const user = (env['SMTP_USER'] ?? '').trim()
  const pass = env['SMTP_PASS'] ?? ''
  const rawPort = (env['SMTP_PORT'] ?? String(DEFAULT_PORT)).trim()
  const port = Number(rawPort)

  if (!host) throw new SmtpConfigError('SMTP_HOST 不能为空')
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new SmtpConfigError('SMTP_PORT 必须是 1～65535 之间的整数')
  }
  if (!user) throw new SmtpConfigError('缺少 SMTP_USER 环境变量')
  if (!pass) throw new SmtpConfigError('缺少 SMTP_PASS 环境变量（邮箱客户端授权码）')

  const from = (env['SMTP_FROM'] ?? user).trim()
  const fromName = (env['SMTP_FROM_NAME'] ?? DEFAULT_FROM_NAME).trim() || DEFAULT_FROM_NAME

  return {
    host,
    port,
    secure: parseBoolean(env['SMTP_SECURE'], port === 465),
    user,
    pass,
    from: from || user,
    fromName,
  }
}
