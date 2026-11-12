import { Injectable, Logger, ServiceUnavailableException, type OnModuleInit } from '@nestjs/common'
import { createTransport } from 'nodemailer'

import { loadSmtpConfig, SmtpConfigError, type SmtpConfig } from './email.config.js'
import { renderRegisterCodeEmail } from './templates/register-code.template.js'

type MailTransporter = ReturnType<typeof createTransport>

export interface SendRegisterCodeOptions {
  /** 收件人邮箱 */
  to: string
  /** 六位验证码，仅用于渲染邮件，绝不写日志 */
  code: string
  /** 有效期（秒） */
  expiresInSeconds: number
  /** 收件人显示名（可选） */
  displayName?: string | null
}

function createServiceUnavailable(message: string): ServiceUnavailableException {
  return new ServiceUnavailableException({ code: 50300, data: null, message })
}

/**
 * 邮件服务（yeah.net SMTP）
 *
 * - 单例 transporter，配置在首次使用时读取并校验
 * - SMTP 配置缺失或发送失败时返回 503，绝不假装发送成功
 * - 日志不输出授权码，也不输出验证码与正文
 */
@Injectable()
export class EmailService implements OnModuleInit {
  private readonly logger = new Logger(EmailService.name)

  private transporter: MailTransporter | null = null
  private config: SmtpConfig | null = null
  private configError: string | null = null

  /** 启动时做一次 SMTP 连接验证；失败只告警，不阻塞应用启动 */
  async onModuleInit(): Promise<void> {
    const available = await this.verifyConnection()

    if (!available) {
      this.logger.warn('SMTP 连接验证未通过，邮件验证码功能将返回“服务不可用”')
    }
  }

  /** 主动验证 SMTP 连接（不抛错，返回布尔值） */
  async verifyConnection(): Promise<boolean> {
    try {
      const { transporter } = this.ensureTransporter()

      await transporter.verify()

      this.logger.log('SMTP 连接验证成功')

      return true
    } catch (error) {
      this.logger.warn(`SMTP 连接验证失败：${this.describeError(error)}`)

      return false
    }
  }

  /** 发送注册验证码邮件 */
  async sendRegisterCode(options: SendRegisterCodeOptions): Promise<void> {
    const { transporter, config } = this.ensureTransporter()
    const mail = renderRegisterCodeEmail({
      code: options.code,
      expiresInSeconds: options.expiresInSeconds,
      appName: config.fromName,
      displayName: options.displayName ?? null,
    })

    try {
      await transporter.sendMail({
        from: { name: config.fromName, address: config.from },
        to: options.to,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      })
    } catch (error) {
      // 只记录错误摘要：不含授权码、不含验证码、不含收件人正文
      this.logger.error(`注册验证码邮件发送失败：${this.describeError(error)}`)

      throw createServiceUnavailable('邮件发送失败，请稍后重试')
    }
  }

  /**
   * 取用（必要时创建）单例 transporter 与 SMTP 配置
   *
   * - 惰性创建：首次真正要发信/验证连接时才读环境变量并建连接，避免应用启动时就依赖 SMTP
   * - 创建成功即缓存，后续调用直接复用，不重复建连接
   * - 创建失败会缓存失败原因：之后每次调用都立刻抛 503，不反复读配置、不重复刷错误日志
   *
   * @returns transporter 与已校验过的 SMTP 配置
   * @throws {ServiceUnavailableException} SMTP 配置缺失或非法（code 50300），对外只给统一文案
   */
  private ensureTransporter(): { transporter: MailTransporter; config: SmtpConfig } {
    if (this.transporter && this.config) {
      return { transporter: this.transporter, config: this.config }
    }

    if (this.configError) {
      throw createServiceUnavailable(this.configError)
    }

    try {
      const config = loadSmtpConfig()

      this.transporter = createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: { user: config.user, pass: config.pass },
      })
      this.config = config

      return { transporter: this.transporter, config }
    } catch (error) {
      this.configError = error instanceof SmtpConfigError ? error.message : '邮件服务配置无效'
      this.logger.error(`SMTP 配置不可用：${this.configError}`)

      // 对外返回统一文案，不暴露具体缺失项之外的信息
      throw createServiceUnavailable(this.configError)
    }
  }

  /**
   * 把 catch 到的任意值转成可写进日志的字符串
   *
   * smtp / nodemailer 抛出的不一定是 Error（也可能是字符串或普通对象），
   * 统一在这里收口，避免日志模板拼接时因非 Error 值而二次抛错。
   * 只取 message，不输出 error 对象本身，防止把授权码等信息带进日志。
   */
  private describeError(error: unknown): string {
    if (error instanceof Error) return error.message

    return String(error)
  }
}
