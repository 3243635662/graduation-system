import { ServiceUnavailableException } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const nodemailerMock = vi.hoisted(() => ({
  createTransport: vi.fn(),
}))

vi.mock('nodemailer', () => nodemailerMock)

import { EmailService } from './email.service.js'

interface FakeTransporter {
  verify: ReturnType<typeof vi.fn>
  sendMail: ReturnType<typeof vi.fn>
}

function createTransporter(
  options: {
    verifyError?: Error
    sendError?: Error
  } = {},
): FakeTransporter {
  return {
    verify: vi.fn(async () => {
      if (options.verifyError) throw options.verifyError

      return true
    }),
    sendMail: vi.fn(async () => {
      if (options.sendError) throw options.sendError

      return { messageId: 'message-1' }
    }),
  }
}

const AUTHORIZATION_CODE = 'authorization-code-should-not-leak'

function setSmtpEnv(): void {
  process.env['SMTP_HOST'] = 'smtp.yeah.net'
  process.env['SMTP_PORT'] = '465'
  process.env['SMTP_SECURE'] = 'true'
  process.env['SMTP_USER'] = 'noreply@yeah.net'
  process.env['SMTP_PASS'] = AUTHORIZATION_CODE
  process.env['SMTP_FROM'] = 'noreply@yeah.net'
  process.env['SMTP_FROM_NAME'] = 'Graduation Management System'
}

describe('EmailService', () => {
  let transporter: FakeTransporter

  beforeEach(() => {
    nodemailerMock.createTransport.mockReset()
    transporter = createTransporter()
    nodemailerMock.createTransport.mockReturnValue(transporter)
    setSmtpEnv()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('使用 yeah.net SMTP 配置创建单例 transporter', async () => {
    const service = new EmailService()

    await service.sendRegisterCode({
      to: 'student@example.com',
      code: '123456',
      expiresInSeconds: 120,
    })
    await service.sendRegisterCode({
      to: 'other@example.com',
      code: '654321',
      expiresInSeconds: 120,
    })

    expect(nodemailerMock.createTransport).toHaveBeenCalledOnce()
    expect(nodemailerMock.createTransport).toHaveBeenCalledWith({
      host: 'smtp.yeah.net',
      port: 465,
      secure: true,
      auth: { user: 'noreply@yeah.net', pass: AUTHORIZATION_CODE },
    })
  })

  it('发送成功时把验证码渲染进邮件正文', async () => {
    const service = new EmailService()

    await service.sendRegisterCode({
      to: 'student@example.com',
      code: '000042',
      expiresInSeconds: 120,
    })

    expect(transporter.sendMail).toHaveBeenCalledOnce()

    const mail = transporter.sendMail.mock.calls[0]?.[0] as {
      from: { name: string; address: string }
      to: string
      subject: string
      html: string
    }

    expect(mail.to).toBe('student@example.com')
    expect(mail.from).toEqual({
      name: 'Graduation Management System',
      address: 'noreply@yeah.net',
    })
    expect(mail.subject).toContain('邮箱验证码')
    expect(mail.html).toContain('000042')
  })

  it('verifyConnection 成功返回 true', async () => {
    const service = new EmailService()

    await expect(service.verifyConnection()).resolves.toBe(true)
    expect(transporter.verify).toHaveBeenCalledOnce()
  })

  it('verifyConnection 失败返回 false 且不抛错', async () => {
    nodemailerMock.createTransport.mockReturnValue(
      createTransporter({ verifyError: new Error('Invalid login: 535') }),
    )

    const service = new EmailService()

    await expect(service.verifyConnection()).resolves.toBe(false)
  })

  it('发送失败返回 503，且不泄露授权码与验证码', async () => {
    nodemailerMock.createTransport.mockReturnValue(
      createTransporter({
        sendError: new Error(`Invalid login: 535 ${AUTHORIZATION_CODE}`),
      }),
    )

    const service = new EmailService()
    const error = await service
      .sendRegisterCode({ to: 'student@example.com', code: '123456', expiresInSeconds: 120 })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ServiceUnavailableException)
    expect((error as Error).message).toBe('邮件发送失败，请稍后重试')
    expect((error as Error).message).not.toContain(AUTHORIZATION_CODE)
    expect((error as Error).message).not.toContain('123456')
  })

  it('缺少 SMTP_PASS 时返回可理解的服务错误', async () => {
    delete process.env['SMTP_PASS']

    const service = new EmailService()
    const error = await service
      .sendRegisterCode({ to: 'student@example.com', code: '123456', expiresInSeconds: 120 })
      .catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ServiceUnavailableException)
    expect((error as Error).message).toContain('SMTP_PASS')
    expect(nodemailerMock.createTransport).not.toHaveBeenCalled()
  })

  it('配置错误只计算一次，后续请求不再重复解析', async () => {
    delete process.env['SMTP_USER']

    const service = new EmailService()

    await expect(service.verifyConnection()).resolves.toBe(false)
    await expect(service.verifyConnection()).resolves.toBe(false)
  })
})
