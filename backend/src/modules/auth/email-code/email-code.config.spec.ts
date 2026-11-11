import { describe, expect, it } from 'vitest'

import { loadEmailCodeConfig } from './email-code.config.js'

const BASE_ENV = {
  OTP_PEPPER: 'a-very-long-random-pepper-value',
}

describe('loadEmailCodeConfig', () => {
  it('缺省值与规范一致', () => {
    const config = loadEmailCodeConfig(BASE_ENV)

    expect(config).toMatchObject({
      codeTtlSeconds: 120,
      resendIntervalSeconds: 60,
      maxAttempts: 5,
      maxSendsPerEmailPerHour: 5,
      maxSendsPerIpHour: 20,
      keyPrefix: 'auth:email-code:register',
    })
  })

  it('支持通过环境变量调整', () => {
    const config = loadEmailCodeConfig({
      ...BASE_ENV,
      EMAIL_CODE_TTL_SECONDS: '300',
      EMAIL_CODE_RESEND_INTERVAL_SECONDS: '30',
      EMAIL_CODE_MAX_ATTEMPTS: '3',
      EMAIL_CODE_MAX_SENDS_PER_HOUR: '2',
      EMAIL_CODE_MAX_SENDS_PER_IP_HOUR: '10',
    })

    expect(config).toMatchObject({
      codeTtlSeconds: 300,
      resendIntervalSeconds: 30,
      maxAttempts: 3,
      maxSendsPerEmailPerHour: 2,
      maxSendsPerIpHour: 10,
    })
  })

  it('拒绝 0 秒 TTL 与无限发送', () => {
    expect(() => loadEmailCodeConfig({ ...BASE_ENV, EMAIL_CODE_TTL_SECONDS: '0' })).toThrowError(
      /EMAIL_CODE_TTL_SECONDS/,
    )
    expect(() =>
      loadEmailCodeConfig({ ...BASE_ENV, EMAIL_CODE_MAX_SENDS_PER_HOUR: '0' }),
    ).toThrowError(/EMAIL_CODE_MAX_SENDS_PER_HOUR/)
    expect(() => loadEmailCodeConfig({ ...BASE_ENV, EMAIL_CODE_MAX_ATTEMPTS: '0' })).toThrowError(
      /EMAIL_CODE_MAX_ATTEMPTS/,
    )
  })

  it('拒绝超出上限的配置', () => {
    expect(() =>
      loadEmailCodeConfig({ ...BASE_ENV, EMAIL_CODE_TTL_SECONDS: '100000' }),
    ).toThrowError(/EMAIL_CODE_TTL_SECONDS/)
    expect(() =>
      loadEmailCodeConfig({ ...BASE_ENV, EMAIL_CODE_MAX_SENDS_PER_IP_HOUR: '100000' }),
    ).toThrowError(/EMAIL_CODE_MAX_SENDS_PER_IP_HOUR/)
  })

  it('缺少 OTP_PEPPER 时抛错', () => {
    expect(() => loadEmailCodeConfig({})).toThrowError(/OTP_PEPPER/)
  })

  it('OTP_PEPPER 过短时抛错', () => {
    expect(() => loadEmailCodeConfig({ OTP_PEPPER: 'short' })).toThrowError(/OTP_PEPPER/)
  })

  it('允许用 EMAIL_CODE_KEY_PREFIX 隔离测试数据', () => {
    const config = loadEmailCodeConfig({ ...BASE_ENV, EMAIL_CODE_KEY_PREFIX: 'test:prefix' })

    expect(config.keyPrefix).toBe('test:prefix')
  })
})
