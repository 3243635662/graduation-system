<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { useAuth } from '@/composables/use-auth'
import { resolveRegisterErrorKey, useEmailCode } from '@/composables/use-email-code'
import { useFieldErrors } from '@/composables/use-field-errors'
import { ApiError } from '@/lib/api-response'
import {
  registerFieldSchemas,
  registerSchema,
  sendEmailCodeSchema,
  type RegisterFormValues,
} from '@/validators/auth.schema'
import { lazyValidate } from '@/validators/lazy-validate'
import {
  ArrowRightIcon,
  EyeIcon,
  EyeOffIcon,
  InfoIcon,
  LockIcon,
  MailIcon,
  ShieldCheckIcon,
  UserIcon,
} from '@lucide/vue'
import { useForm } from '@tanstack/vue-form'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

const router = useRouter()
const { register } = useAuth()
const { t } = useI18n()
const translateErrors = useFieldErrors()

const loading = ref(false)
const showPassword = ref(false)
const showConfirmPassword = ref(false)
const submitErrorKey = ref<string | null>(null)
const submitErrorText = ref('')

const {
  sending: sendingCode,
  secondsLeft: resendSeconds,
  sent: codeSent,
  errorKey: codeErrorKey,
  canSend: canSendCode,
  send: sendCode,
} = useEmailCode()

const submitError = computed(() => {
  if (submitErrorKey.value) return t(submitErrorKey.value)

  return submitErrorText.value
})

const codeError = computed(() => (codeErrorKey.value ? t(codeErrorKey.value) : ''))

function resolveErrorMessage(error: unknown, fallbackKey: string): { key: string; text: string } {
  if (error instanceof ApiError) {
    if (error.issues.length > 0) {
      return { key: '', text: error.issues.map((issue) => issue.message).join('；') }
    }

    const mappedKey = resolveRegisterErrorKey(error)

    if (mappedKey) return { key: mappedKey, text: '' }
  }

  return { key: fallbackKey, text: error instanceof Error ? error.message : '' }
}

const form = useForm({
  defaultValues: {
    displayName: '',
    email: '',
    emailCode: '',
    password: '',
    confirmPassword: '',
  } satisfies RegisterFormValues,
  // 整表只在校验提交时跑一次，避免单个输入框失焦就把所有字段的报错点亮
  validators: {
    onSubmit: registerSchema,
  },
  onSubmit: async ({ value }) => {
    if (loading.value) return

    loading.value = true
    submitErrorKey.value = null
    submitErrorText.value = ''

    try {
      await register(value)
    } catch (error) {
      const resolved = resolveErrorMessage(error, 'registerForm.emailCode.registerFailed')

      submitErrorKey.value = resolved.key || null
      submitErrorText.value = resolved.text
    } finally {
      loading.value = false
    }
  },
})

/** 字段级惰性校验：只在用户改动过、失焦后才提示 */
const fieldValidators = {
  displayName: lazyValidate(registerFieldSchemas.displayName),
  email: lazyValidate(registerFieldSchemas.email),
  emailCode: lazyValidate(registerFieldSchemas.emailCode),
  password: lazyValidate(registerFieldSchemas.password),
  // 确认密码：先过必填，再与密码比对；改密码时也会跟着更新提示
  confirmPassword: lazyValidate(registerFieldSchemas.confirmPassword, (value) =>
    value === form.state.values.password ? [] : [{ message: 'validation.passwordMismatch' }],
  ),
}

/** 表单中的邮箱值（响应式），用于控制发送按钮是否可用 */
const currentEmail = form.useStore((state) => state.values.email)
const emailReady = computed(
  () => sendEmailCodeSchema.safeParse({ email: currentEmail.value ?? '' }).success,
)
const sendDisabled = computed(() => !canSendCode.value || !emailReady.value)

async function handleSendCode(): Promise<void> {
  await sendCode(currentEmail.value ?? '')
}
</script>

<template>
  <div
    class="w-full max-w-[420px] rounded-[28px] glass-card p-5 sm:p-6 relative overflow-hidden transition-colors duration-300"
  >
    <!-- 右上角拟态玻璃发光装饰：颜色取自 --primary -->
    <div class="absolute -top-10 -right-10 w-40 h-40 pointer-events-none select-none opacity-70">
      <svg
        viewBox="0 0 200 200"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        class="w-full h-full"
      >
        <defs>
          <linearGradient
            id="registerRingGrad"
            x1="20"
            y1="20"
            x2="180"
            y2="180"
            gradientUnits="userSpaceOnUse"
          >
            <stop style="stop-color: var(--primary)" stop-opacity="0.75" />
            <stop offset="0.5" style="stop-color: var(--primary)" stop-opacity="0.4" />
            <stop offset="1" style="stop-color: var(--primary)" stop-opacity="0.1" />
          </linearGradient>
        </defs>
        <circle
          cx="120"
          cy="80"
          r="60"
          stroke="url(#registerRingGrad)"
          stroke-width="24"
          stroke-linecap="round"
          stroke-dasharray="140 60"
        />
        <circle
          cx="120"
          cy="80"
          r="60"
          class="text-primary"
          stroke="currentColor"
          stroke-width="4"
          stroke-linecap="round"
          stroke-dasharray="40 180"
          opacity="0.35"
        />
      </svg>
    </div>

    <!-- 顶部小徽章 -->
    <div class="mb-1">
      <div
        class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold tracking-wider text-primary bg-primary/10 border border-primary/20"
      >
        <span>{{ $t('registerForm.badge') }}</span>
        <span class="w-2.5 h-[2px] bg-primary rounded-full" />
      </div>
    </div>

    <!-- 标题 -->
    <div class="mb-3">
      <h2 class="text-xl sm:text-2xl font-extrabold tracking-tight text-card-foreground">
        {{ $t('registerForm.title') }}
      </h2>
      <p class="text-xs text-muted-foreground mt-0.5">
        {{ $t('registerForm.description') }}
      </p>
    </div>

    <!-- 表单主体 -->
    <form class="flex flex-col gap-2.5" novalidate @submit.prevent="form.handleSubmit">
      <FieldGroup class="gap-2">
        <!-- 姓名输入框 -->
        <form.Field name="displayName" :validators="fieldValidators.displayName">
          <template #default="{ field, state }">
            <Field :data-invalid="state.meta.errors.length > 0">
              <FieldLabel :for="field.name" class="sr-only">
                {{ $t('registerForm.fullNameLabel') }}
              </FieldLabel>
              <div class="relative group">
                <div
                  class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-muted-foreground group-focus-within:text-primary transition-colors"
                >
                  <UserIcon class="w-4 h-4" />
                </div>
                <input
                  :id="field.name"
                  :value="field.state.value"
                  type="text"
                  autocomplete="name"
                  :placeholder="$t('registerForm.fullNamePlaceholder')"
                  class="w-full h-10 pl-9 pr-3 rounded-lg bg-muted/60 border border-input aria-[invalid=true]:border-destructive/60 text-xs sm:text-sm text-foreground placeholder:text-muted-foreground focus:bg-background focus:border-primary focus:ring-4 focus:ring-primary/20 focus:outline-none transition-all duration-200"
                  :aria-invalid="state.meta.errors.length > 0"
                  @input="field.handleChange(($event.target as HTMLInputElement).value)"
                  @blur="field.handleBlur"
                />
              </div>
              <FieldError
                :errors="translateErrors(state.meta.errors)"
                class="animate-auth-feedback text-[11px] leading-tight motion-reduce:animate-none"
              />
            </Field>
          </template>
        </form.Field>

        <!-- 邮箱输入框 -->
        <form.Field name="email" :validators="fieldValidators.email">
          <template #default="{ field, state }">
            <Field :data-invalid="state.meta.errors.length > 0">
              <FieldLabel :for="field.name" class="sr-only">
                {{ $t('registerForm.emailLabel') }}
              </FieldLabel>
              <div class="relative group">
                <div
                  class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-muted-foreground group-focus-within:text-primary transition-colors"
                >
                  <MailIcon class="w-4 h-4" />
                </div>
                <input
                  :id="field.name"
                  :value="field.state.value"
                  type="email"
                  autocomplete="email"
                  :placeholder="$t('registerForm.emailPlaceholder')"
                  class="w-full h-10 pl-9 pr-3 rounded-lg bg-muted/60 border border-input aria-[invalid=true]:border-destructive/60 text-xs sm:text-sm text-foreground placeholder:text-muted-foreground focus:bg-background focus:border-primary focus:ring-4 focus:ring-primary/20 focus:outline-none transition-all duration-200"
                  :aria-invalid="state.meta.errors.length > 0"
                  @input="field.handleChange(($event.target as HTMLInputElement).value)"
                  @blur="field.handleBlur"
                />
              </div>
              <FieldError
                :errors="translateErrors(state.meta.errors)"
                class="animate-auth-feedback text-[11px] leading-tight motion-reduce:animate-none"
              />
            </Field>
          </template>
        </form.Field>

        <!-- 邮箱验证码：六位数字 + 发送按钮 + 倒计时 -->
        <form.Field name="emailCode" :validators="fieldValidators.emailCode">
          <template #default="{ field, state }">
            <Field :data-invalid="state.meta.errors.length > 0 || Boolean(codeError)">
              <FieldLabel :for="field.name" class="sr-only">
                {{ t('registerForm.emailCode.label') }}
              </FieldLabel>
              <div class="flex items-stretch gap-1.5">
                <div class="relative group flex-1 min-w-0">
                  <div
                    class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-muted-foreground group-focus-within:text-primary transition-colors"
                  >
                    <ShieldCheckIcon class="w-4 h-4" />
                  </div>
                  <input
                    :id="field.name"
                    :value="field.state.value"
                    type="text"
                    inputmode="numeric"
                    maxlength="6"
                    autocomplete="one-time-code"
                    :placeholder="t('registerForm.emailCode.placeholder')"
                    class="w-full h-10 pl-9 pr-3 rounded-lg bg-muted/60 border border-input aria-[invalid=true]:border-destructive/60 text-xs sm:text-sm tracking-[0.3em] text-foreground placeholder:tracking-normal placeholder:text-muted-foreground focus:bg-background focus:border-primary focus:ring-4 focus:ring-primary/20 focus:outline-none transition-all duration-200"
                    :aria-invalid="state.meta.errors.length > 0"
                    @input="field.handleChange(($event.target as HTMLInputElement).value)"
                    @blur="field.handleBlur"
                  />
                </div>
                <button
                  type="button"
                  class="shrink-0 h-10 px-3 rounded-lg border border-primary/30 bg-primary/10 text-[11px] sm:text-xs font-semibold text-primary hover:bg-primary/15 hover:border-primary/50 focus:outline-none focus:ring-4 focus:ring-primary/20 transition-all duration-200 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1 min-w-[92px]"
                  :disabled="sendDisabled"
                  @click="handleSendCode"
                >
                  <Spinner v-if="sendingCode" class="w-3.5 h-3.5 text-primary" />
                  <span v-else-if="resendSeconds > 0">
                    {{ t('registerForm.emailCode.resend', { seconds: resendSeconds }) }}
                  </span>
                  <span v-else>{{ t('registerForm.emailCode.send') }}</span>
                </button>
              </div>
              <FieldError
                :errors="translateErrors(state.meta.errors)"
                class="animate-auth-feedback text-[11px] leading-tight motion-reduce:animate-none"
              />
              <p v-if="codeError" class="text-[11px] text-destructive">{{ codeError }}</p>
              <p v-else-if="codeSent" class="text-[11px] text-emerald-600 dark:text-emerald-400">
                {{ t('registerForm.emailCode.sent') }}
              </p>
              <p v-else class="text-[11px] text-muted-foreground">
                {{ t('registerForm.emailCode.hint') }}
              </p>
            </Field>
          </template>
        </form.Field>

        <!-- 密码输入框 -->
        <form.Field name="password" :validators="fieldValidators.password">
          <template #default="{ field, state }">
            <Field :data-invalid="state.meta.errors.length > 0">
              <FieldLabel :for="field.name" class="sr-only">
                {{ $t('registerForm.passwordLabel') }}
              </FieldLabel>
              <div class="relative group">
                <div
                  class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-muted-foreground group-focus-within:text-primary transition-colors"
                >
                  <LockIcon class="w-4 h-4" />
                </div>
                <input
                  :id="field.name"
                  :value="field.state.value"
                  :type="showPassword ? 'text' : 'password'"
                  autocomplete="new-password"
                  :placeholder="$t('registerForm.passwordPlaceholder')"
                  class="w-full h-10 pl-9 pr-9 rounded-lg bg-muted/60 border border-input aria-[invalid=true]:border-destructive/60 text-xs sm:text-sm text-foreground placeholder:text-muted-foreground focus:bg-background focus:border-primary focus:ring-4 focus:ring-primary/20 focus:outline-none transition-all duration-200"
                  :aria-invalid="state.meta.errors.length > 0"
                  @input="field.handleChange(($event.target as HTMLInputElement).value)"
                  @blur="field.handleBlur"
                />
                <button
                  type="button"
                  tabindex="-1"
                  class="absolute inset-y-0 right-0 pr-2.5 flex items-center text-muted-foreground hover:text-foreground transition-colors focus:outline-none cursor-pointer"
                  :aria-label="
                    showPassword ? $t('registerForm.hidePassword') : $t('registerForm.showPassword')
                  "
                  @click="showPassword = !showPassword"
                >
                  <EyeOffIcon v-if="showPassword" class="w-4 h-4" />
                  <EyeIcon v-else class="w-4 h-4" />
                </button>
              </div>
              <FieldError
                :errors="translateErrors(state.meta.errors)"
                class="animate-auth-feedback text-[11px] leading-tight motion-reduce:animate-none"
              />
            </Field>
          </template>
        </form.Field>

        <!-- 确认密码输入框 -->
        <form.Field name="confirmPassword" :validators="fieldValidators.confirmPassword">
          <template #default="{ field, state }">
            <Field :data-invalid="state.meta.errors.length > 0">
              <FieldLabel :for="field.name" class="sr-only">
                {{ $t('registerForm.confirmPasswordLabel') }}
              </FieldLabel>
              <div class="relative group">
                <div
                  class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-muted-foreground group-focus-within:text-primary transition-colors"
                >
                  <LockIcon class="w-4 h-4" />
                </div>
                <input
                  :id="field.name"
                  :value="field.state.value"
                  :type="showConfirmPassword ? 'text' : 'password'"
                  autocomplete="new-password"
                  :placeholder="$t('registerForm.confirmPasswordPlaceholder')"
                  class="w-full h-10 pl-9 pr-9 rounded-lg bg-muted/60 border border-input aria-[invalid=true]:border-destructive/60 text-xs sm:text-sm text-foreground placeholder:text-muted-foreground focus:bg-background focus:border-primary focus:ring-4 focus:ring-primary/20 focus:outline-none transition-all duration-200"
                  :aria-invalid="state.meta.errors.length > 0"
                  @input="field.handleChange(($event.target as HTMLInputElement).value)"
                  @blur="field.handleBlur"
                />
                <button
                  type="button"
                  tabindex="-1"
                  class="absolute inset-y-0 right-0 pr-2.5 flex items-center text-muted-foreground hover:text-foreground transition-colors focus:outline-none cursor-pointer"
                  :aria-label="
                    showConfirmPassword
                      ? $t('registerForm.hidePassword')
                      : $t('registerForm.showPassword')
                  "
                  @click="showConfirmPassword = !showConfirmPassword"
                >
                  <EyeOffIcon v-if="showConfirmPassword" class="w-4 h-4" />
                  <EyeIcon v-else class="w-4 h-4" />
                </button>
              </div>
              <FieldError
                :errors="translateErrors(state.meta.errors)"
                class="animate-auth-feedback text-[11px] leading-tight motion-reduce:animate-none"
              />
            </Field>
          </template>
        </form.Field>
      </FieldGroup>

      <!-- 学生账号提示信息框 -->
      <div
        class="px-2.5 py-1.5 rounded-lg bg-muted/70 border border-border flex items-center gap-1.5 text-[11px] text-muted-foreground"
      >
        <InfoIcon class="w-3.5 h-3.5 shrink-0 text-primary" />
        <i18n-t keypath="registerForm.studentHint" tag="span" scope="global">
          <template #role>
            <strong class="text-foreground">{{ $t('registerForm.studentRole') }}</strong>
          </template>
        </i18n-t>
      </div>

      <!-- 错误提示 -->
      <div
        v-if="submitError"
        class="animate-auth-feedback p-2 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs motion-reduce:animate-none"
      >
        {{ submitError }}
      </div>

      <!-- 渐变提交按钮 -->
      <Button
        type="submit"
        class="w-full h-10 sm:h-11 rounded-xl text-sm font-semibold text-primary-foreground bg-primary shadow-md shadow-primary/25 hover:bg-primary/90 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary/30 active:translate-y-0 active:scale-[0.99] transition-all duration-200 flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-70 disabled:hover:translate-y-0 mt-0.5"
        :disabled="loading"
      >
        <Spinner v-if="loading" class="w-4 h-4 text-primary-foreground" />
        <span v-else class="flex items-center gap-1.5">
          {{ $t('registerForm.submit') }}
          <ArrowRightIcon class="w-4 h-4" />
        </span>
      </Button>

      <!-- 底部跳转登录 -->
      <div class="mt-1 pt-2 border-t border-border text-center text-xs text-muted-foreground">
        <span>{{ $t('registerForm.haveAccount') }}</span>
        <button
          type="button"
          class="font-semibold text-primary hover:text-primary/80 hover:underline cursor-pointer transition-colors"
          @click="router.push('/auth/sign-in')"
        >
          {{ $t('registerForm.signIn') }}
        </button>
      </div>
    </form>
  </div>
</template>
