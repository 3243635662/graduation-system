import { escapeHtml, formatExpiry, type RenderedMail } from './register-code.template.js'

export interface BindEmailCodeTemplateOptions {
  /** 六位验证码（纯数字） */
  code: string
  /** 有效期（秒） */
  expiresInSeconds: number
  /** 项目名称 */
  appName: string
  /** 收件人显示名（可选，仅用于问候） */
  displayName?: string | null
}

export function renderBindEmailCodeEmail(options: BindEmailCodeTemplateOptions): RenderedMail {
  const { code, expiresInSeconds, appName, displayName } = options
  const safeAppName = escapeHtml(appName)
  const safeName = displayName ? escapeHtml(displayName) : ''
  const expiry = escapeHtml(formatExpiry(expiresInSeconds))
  const greeting = safeName ? `${safeName}，你好：` : '你好：'

  const subject = `${appName} - 更换绑定邮箱验证码`

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f4f5f7;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background-color:#ffffff;border-radius:12px;border:1px solid #e5e7eb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;">
            <tr>
              <td style="padding:28px 32px 8px 32px;">
                <div style="font-size:13px;letter-spacing:2px;color:#6b7280;text-transform:uppercase;">${safeAppName}</div>
                <h1 style="margin:12px 0 0 0;font-size:20px;line-height:1.4;color:#111827;font-weight:600;">更换绑定邮箱验证码</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 0 32px;font-size:14px;line-height:1.7;color:#374151;">
                <p style="margin:12px 0 0 0;">${greeting}</p>
                <p style="margin:8px 0 0 0;">你正在将此邮箱绑定为系统账号的登录邮箱，请在换绑页面填写下方验证码完成验证。</p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:24px 32px;">
                <div style="display:inline-block;padding:16px 28px;background-color:#f3f4f6;border:1px solid #e5e7eb;border-radius:10px;font-family:'SFMono-Regular',Consolas,'Courier New',monospace;font-size:30px;letter-spacing:8px;color:#111827;font-weight:600;">${code}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px;font-size:14px;line-height:1.7;color:#374151;">
                <p style="margin:0;">验证码 ${expiry}内有效，请勿转发给他人。</p>
                <p style="margin:12px 0 0 0;color:#dc2626;">如非本人操作，请忽略本邮件，邮箱不会被更换。</p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 32px 28px 32px;">
                <div style="border-top:1px solid #e5e7eb;padding-top:16px;font-size:12px;line-height:1.6;color:#9ca3af;">
                  此邮件由系统自动发送，请勿直接回复。
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`

  const text = [
    `${greeting}`,
    '',
    `你正在将此邮箱绑定为${appName}账号的登录邮箱，验证码：${code}`,
    `验证码 ${formatExpiry(expiresInSeconds)}内有效，请勿转发给他人。`,
    '',
    '如非本人操作，请忽略本邮件，邮箱不会被更换。',
    '此邮件由系统自动发送，请勿直接回复。',
  ].join('\n')

  return { subject, html, text }
}
