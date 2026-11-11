/**
 * 捕获验证码的假邮件服务
 *
 * 自动化测试绝不真的发信：这里只记录 EmailCodeService 传入的验证码，
 * 让 E2E 能拿到「用户邮箱里收到的那个验证码」。
 */

export interface CapturedMail {
  to: string
  code: string
  expiresInSeconds: number
}

export class CapturingEmailService {
  readonly sent: CapturedMail[] = []
  private failure: Error | null = null

  /** 让下一次发送失败，用于验证 SMTP 故障时的失败关闭 */
  failNextWith(error: Error): void {
    this.failure = error
  }

  async sendRegisterCode(options: CapturedMail): Promise<void> {
    if (this.failure) {
      const failure = this.failure
      this.failure = null

      throw failure
    }

    this.sent.push(options)
  }

  reset(): void {
    this.sent.length = 0
    this.failure = null
  }

  /** 取指定收件人最近一次收到的验证码 */
  lastCodeFor(email: string): string {
    const mail = [...this.sent].reverse().find((item) => item.to === email)

    if (!mail) throw new Error(`没有捕获到发往 ${email} 的验证码邮件`)

    return mail.code
  }
}
