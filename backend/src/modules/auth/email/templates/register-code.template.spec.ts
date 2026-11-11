import { describe, expect, it } from 'vitest'

import { escapeHtml, formatExpiry, renderRegisterCodeEmail } from './register-code.template.js'

describe('register-code 邮件模板', () => {
  it('渲染项目名称、验证码与有效期', () => {
    const mail = renderRegisterCodeEmail({
      code: '123456',
      expiresInSeconds: 120,
      appName: 'Graduation Management System',
    })

    expect(mail.subject).toBe('Graduation Management System - 邮箱验证码')
    expect(mail.html).toContain('123456')
    expect(mail.html).toContain('2 分钟')
    expect(mail.text).toContain('123456')
    expect(mail.text).toContain('2 分钟')
  })

  it('提示语包含安全提醒与忽略操作说明', () => {
    const mail = renderRegisterCodeEmail({
      code: '123456',
      expiresInSeconds: 120,
      appName: 'GMS',
    })

    expect(mail.html).toContain('请勿转发给他人')
    expect(mail.html).toContain('忽略本邮件')
  })

  it('不使用外部图片', () => {
    const mail = renderRegisterCodeEmail({
      code: '000042',
      expiresInSeconds: 120,
      appName: 'GMS',
    })

    expect(mail.html).not.toContain('<img')
    expect(mail.html).not.toMatch(/https?:\/\//)
  })

  it('保留六位验证码的前导零', () => {
    const mail = renderRegisterCodeEmail({
      code: '000042',
      expiresInSeconds: 120,
      appName: 'GMS',
    })

    expect(mail.html).toContain('000042')
  })

  it('动态内容被 HTML 转义', () => {
    const mail = renderRegisterCodeEmail({
      code: '123456',
      expiresInSeconds: 120,
      appName: '<script>alert(1)</script>',
      displayName: '<img src=x onerror=alert(1)>',
    })

    expect(mail.html).not.toContain('<script>')
    expect(mail.html).not.toContain('<img src=x')
    expect(mail.html).toContain('&lt;script&gt;')
  })

  it('escapeHtml 转义全部关键字符', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;')
  })

  it('formatExpiry 兼容非整分钟', () => {
    expect(formatExpiry(60)).toBe('1 分钟')
    expect(formatExpiry(90)).toBe('90 秒')
  })
})
