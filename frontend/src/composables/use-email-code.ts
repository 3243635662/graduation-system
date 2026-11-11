import { ApiError } from '@/lib/api-response'
import { sendRegisterCode } from '@/services/api/auth.api'
import { sendEmailCodeSchema } from '@/validators/auth.schema'
import { computed, onScopeDispose, ref } from 'vue'

/** 服务端返回 resendAfter 异常时的兜底冷却时间（秒） */
const FALLBACK_COOLDOWN_SECONDS = 60

/** 错误码与 i18n key 的映射，避免组件里散落判断逻辑 */
const SEND_ERROR_KEY: Record<number, string> = {
  42900: 'registerForm.emailCode.tooMany',
  50300: 'registerForm.emailCode.sendFailed',
}

const REGISTER_ERROR_KEY: Record<number, string> = {
  40011: 'registerForm.emailCode.wrongCode',
  40012: 'registerForm.emailCode.expired',
  40013: 'registerForm.emailCode.exhausted',
  42900: 'registerForm.emailCode.tooMany',
  50300: 'registerForm.emailCode.sendFailed',
}

function toErrorKey(error: unknown, map: Record<number, string>, fallback: string): string {
  if (error instanceof ApiError) {
    return map[error.code] ?? fallback
  }

  return fallback
}

/**
 * 注册接口的失败提示 key（供表单提交复用）
 *
 * 未命中映射时返回 null，由调用方决定展示服务端原文还是兜底文案
 * （例如 40900「该邮箱已被注册」需要原样展示）。
 */
export function resolveRegisterErrorKey(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null

  return REGISTER_ERROR_KEY[error.code] ?? null
}

/**
 * 邮箱验证码发送与倒计时
 *
 * 只负责交互层：倒计时仅为展示，真正的发送限制由后端 Redis 强制实施，
 * 因此前端倒计时被篡改也无法绕过服务端限流。
 */
export function useEmailCode() {
  const sending = ref(false)
  const secondsLeft = ref(0)
  const sent = ref(false)
  const errorKey = ref<string | null>(null)

  let timer: ReturnType<typeof setInterval> | null = null

  function clearTimer(): void {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  function stopCountdown(): void {
    clearTimer()
    secondsLeft.value = 0
  }

  function startCountdown(seconds: number): void {
    clearTimer()
    secondsLeft.value = Math.max(0, Math.ceil(seconds))

    if (secondsLeft.value === 0) return

    timer = setInterval(() => {
      secondsLeft.value = Math.max(0, secondsLeft.value - 1)

      if (secondsLeft.value === 0) {
        clearTimer()
      }
    }, 1000)
  }

  const canSend = computed(() => !sending.value && secondsLeft.value === 0)

  /** 发送验证码；返回是否成功，便于调用方决定是否聚焦输入框 */
  async function send(email: string): Promise<boolean> {
    if (!canSend.value) return false

    errorKey.value = null

    const parsed = sendEmailCodeSchema.safeParse({ email })

    if (!parsed.success) {
      errorKey.value = 'registerForm.emailCode.invalidEmail'

      return false
    }

    sending.value = true

    try {
      const result = await sendRegisterCode(parsed.data.email)

      sent.value = true
      startCountdown(result.resendAfter || FALLBACK_COOLDOWN_SECONDS)

      return true
    } catch (error) {
      errorKey.value = toErrorKey(error, SEND_ERROR_KEY, 'registerForm.emailCode.sendFailed')

      return false
    } finally {
      sending.value = false
    }
  }

  function reset(): void {
    stopCountdown()
    sending.value = false
    sent.value = false
    errorKey.value = null
  }

  // 组件/作用域销毁时清理定时器，避免离开页面后仍在计数
  onScopeDispose(stopCountdown)

  return {
    sending,
    secondsLeft,
    sent,
    errorKey,
    canSend,
    send,
    startCountdown,
    stopCountdown,
    reset,
  }
}
