/**
 * 注册验证码邮件模板
 *
 * 兼容性优先：表格布局 + 内联样式，不使用外部图片与 <style> 标签，
 * 保证在常见邮箱客户端（网易、QQ、Gmail、Outlook）中都能正常渲染。
 */

export interface RegisterCodeTemplateOptions {
  /** 六位验证码（纯数字） */
  code: string
  /** 有效期（秒） */
  expiresInSeconds: number
  /** 项目名称 */
  appName: string
  /** 收件人显示名（可选，仅用于问候） */
  displayName?: string | null
}

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** 转义动态内容，避免收件人姓名等字段注入 HTML */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPE_MAP[char] ?? char)
}

/** 把秒数转成更易读的时长描述 */
export function formatExpiry(expiresInSeconds: number): string {
  if (expiresInSeconds % 60 === 0) {
    return `${expiresInSeconds / 60} 分钟`
  }

  return `${expiresInSeconds} 秒`
}

export interface RenderedMail {
  subject: string
  html: string
  text: string
}

export function renderRegisterCodeEmail(options: RegisterCodeTemplateOptions): RenderedMail {
  const { code, expiresInSeconds, appName, displayName } = options
  const safeAppName = escapeHtml(appName)
  const safeName = displayName ? escapeHtml(displayName) : ''
  const expiry = escapeHtml(formatExpiry(expiresInSeconds))
  const greeting = safeName ? `${safeName}，你好：` : '你好：'

  const subject = `${appName} - 邮箱验证码`

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
                <h1 style="margin:12px 0 0 0;font-size:20px;line-height:1.4;color:#111827;font-weight:600;">邮箱验证码</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 0 32px;font-size:14px;line-height:1.7;color:#374151;">
                <p style="margin:12px 0 0 0;">${greeting}</p>
                <p style="margin:8px 0 0 0;">你正在注册毕业设计管理系统账号，请在注册页面填写下方验证码完成邮箱验证。</p>
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
                <p style="margin:12px 0 0 0;color:#6b7280;">如果这不是你本人的操作，请忽略本邮件，你的邮箱不会被注册。</p>
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
    `你正在注册${appName}账号，验证码：${code}`,
    `验证码 ${formatExpiry(expiresInSeconds)}内有效，请勿转发给他人。`,
    '',
    '如果这不是你本人的操作，请忽略本邮件。',
    '此邮件由系统自动发送，请勿直接回复。',
  ].join('\n')

  return { subject, html, text }
}
