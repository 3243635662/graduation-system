import { ApiError } from '@/lib/api-response'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'

const authApi = vi.hoisted(() => ({
  sendRegisterCode: vi.fn(),
}))

vi.mock('@/services/api/auth.api', () => authApi)

import { useEmailCode } from '../use-email-code'

/** 在 effectScope 中运行，模拟组件卸载时的清理行为 */
function setup() {
  const scope = effectScope()

  const state = scope.run(() => useEmailCode())

  if (!state) throw new Error('composable 初始化失败')

  return { state, scope }
}

describe('useEmailCode', () => {
  beforeEach(() => {
    authApi.sendRegisterCode.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('邮箱格式非法时不发起请求', async () => {
    const { state } = setup()

    await expect(state.send('not-an-email')).resolves.toBe(false)

    expect(authApi.sendRegisterCode).not.toHaveBeenCalled()
    expect(state.errorKey.value).toBe('registerForm.emailCode.invalidEmail')
    expect(state.secondsLeft.value).toBe(0)
  })

  it('发送成功后进入 60 秒倒计时并禁止重复发送', async () => {
    vi.useFakeTimers()
    authApi.sendRegisterCode.mockResolvedValue({ expiresIn: 120, resendAfter: 60 })

    const { state } = setup()

    await expect(state.send(' student@example.com ')).resolves.toBe(true)

    // 邮箱已规范化后再提交
    expect(authApi.sendRegisterCode).toHaveBeenCalledWith('student@example.com')
    expect(state.sent.value).toBe(true)
    expect(state.secondsLeft.value).toBe(60)
    expect(state.canSend.value).toBe(false)
    expect(state.sending.value).toBe(false)

    // 倒计时期间再次点击不会重复请求
    await expect(state.send('student@example.com')).resolves.toBe(false)
    expect(authApi.sendRegisterCode).toHaveBeenCalledOnce()
  })

  it('倒计时逐秒递减，归零后允许重新发送', async () => {
    vi.useFakeTimers()
    authApi.sendRegisterCode.mockResolvedValue({ expiresIn: 120, resendAfter: 3 })

    const { state } = setup()

    await state.send('student@example.com')

    expect(state.secondsLeft.value).toBe(3)

    await vi.advanceTimersByTimeAsync(1_000)
    expect(state.secondsLeft.value).toBe(2)

    await vi.advanceTimersByTimeAsync(1_000)
    expect(state.secondsLeft.value).toBe(1)

    await vi.advanceTimersByTimeAsync(1_000)
    expect(state.secondsLeft.value).toBe(0)
    expect(state.canSend.value).toBe(true)
  })

  it('429 显示限流提示且不启动倒计时', async () => {
    const { state } = setup()
    authApi.sendRegisterCode.mockRejectedValue(
      new ApiError(42900, '验证码发送过于频繁，请稍后再试'),
    )

    await expect(state.send('student@example.com')).resolves.toBe(false)

    expect(state.errorKey.value).toBe('registerForm.emailCode.tooMany')
    expect(state.secondsLeft.value).toBe(0)
    expect(state.sent.value).toBe(false)
  })

  it('服务不可用时显示发送失败', async () => {
    const { state } = setup()
    authApi.sendRegisterCode.mockRejectedValue(new ApiError(50300, '邮件发送失败，请稍后重试'))

    await expect(state.send('student@example.com')).resolves.toBe(false)

    expect(state.errorKey.value).toBe('registerForm.emailCode.sendFailed')
  })

  it('网络异常同样落到发送失败提示', async () => {
    const { state } = setup()
    authApi.sendRegisterCode.mockRejectedValue(new Error('Failed to fetch'))

    await expect(state.send('student@example.com')).resolves.toBe(false)

    expect(state.errorKey.value).toBe('registerForm.emailCode.sendFailed')
  })

  it('发送过程中按钮不可用（Loading 状态）', async () => {
    let resolveSend: ((value: { expiresIn: number; resendAfter: number }) => void) | undefined

    authApi.sendRegisterCode.mockReturnValue(
      new Promise((resolve) => {
        resolveSend = resolve
      }),
    )

    const { state } = setup()

    const pending = state.send('student@example.com')

    await Promise.resolve()

    expect(state.sending.value).toBe(true)
    expect(state.canSend.value).toBe(false)
    // 发送中的重复点击被忽略
    await expect(state.send('student@example.com')).resolves.toBe(false)
    expect(authApi.sendRegisterCode).toHaveBeenCalledOnce()

    resolveSend?.({ expiresIn: 120, resendAfter: 60 })
    await pending

    expect(state.sending.value).toBe(false)
    expect(state.secondsLeft.value).toBe(60)
  })

  it('作用域销毁时清理定时器', async () => {
    vi.useFakeTimers()
    authApi.sendRegisterCode.mockResolvedValue({ expiresIn: 120, resendAfter: 60 })

    const { state, scope } = setup()

    await state.send('student@example.com')
    expect(state.secondsLeft.value).toBe(60)

    scope.stop()

    expect(state.secondsLeft.value).toBe(0)

    await vi.advanceTimersByTimeAsync(5_000)

    // 定时器已清理，不再继续递减
    expect(state.secondsLeft.value).toBe(0)
  })
})
