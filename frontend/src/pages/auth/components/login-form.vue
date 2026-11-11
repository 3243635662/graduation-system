<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { useAuth } from '@/composables/use-auth'
import { useFieldErrors } from '@/composables/use-field-errors'
import { ApiError } from '@/lib/api-response'
import { loginFieldSchemas, loginSchema, type LoginFormValues } from '@/validators/auth.schema'
import { lazyValidate } from '@/validators/lazy-validate'
import { ArrowRightIcon, EyeIcon, EyeOffIcon, LockIcon, MailIcon } from '@lucide/vue'
import { useForm } from '@tanstack/vue-form'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import ToForgotPasswordLink from './to-forgot-password-link.vue'

const router = useRouter()
const { login } = useAuth()
const { t } = useI18n()
const translateErrors = useFieldErrors()

const loading = ref(false)
const showPassword = ref(false)
const rememberMe = ref(false)
const submitError = ref('')

function resolveErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.issues.length > 0) {
    return error.issues.map((issue) => issue.message).join('；')
  }

  return error instanceof Error && error.message ? error.message : fallback
}

/** 字段级惰性校验：只在用户改动过、失焦后才提示 */
const fieldValidators = {
  email: lazyValidate(loginFieldSchemas.email),
  password: lazyValidate(loginFieldSchemas.password),
}

const form = useForm({
  defaultValues: { email: '', password: '' } satisfies LoginFormValues,
  // 整表只在校验提交时跑一次，避免单个输入框失焦就把所有字段的报错点亮
  validators: {
    onSubmit: loginSchema,
  },
  onSubmit: async ({ value }) => {
    if (loading.value) return

    loading.value = true
    submitError.value = ''

    try {
      await login(value)
    } catch (error) {
      submitError.value = resolveErrorMessage(error, t('loginForm.failed'))
    } finally {
      loading.value = false
    }
  },
})
</script>

<template>
  <div
    class="w-full max-w-[410px] rounded-[28px] glass-card p-6 sm:p-7 relative overflow-hidden transition-colors duration-300"
  >
    <!-- 右上角 3D 拟态玻璃圆环装饰：颜色取自 --primary -->
    <div class="absolute -top-10 -right-10 w-40 h-40 pointer-events-none select-none opacity-70">
      <svg
        viewBox="0 0 200 200"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        class="w-full h-full"
      >
        <defs>
          <linearGradient
            id="loginRingGrad"
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
          stroke="url(#loginRingGrad)"
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

    <!-- 顶部欢迎小标 -->
    <div class="mb-1.5">
      <div
        class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-semibold tracking-wider text-primary bg-primary/10 border border-primary/20"
      >
        <span>{{ $t('loginForm.badge') }}</span>
        <span class="w-2.5 h-[2px] bg-primary rounded-full" />
      </div>
    </div>

    <!-- 标题与副标题 -->
    <div class="mb-4">
      <h2 class="text-xl sm:text-2xl font-extrabold tracking-tight text-card-foreground">
        {{ $t('loginForm.title') }}
      </h2>
      <p class="text-xs text-muted-foreground mt-1">{{ $t('loginForm.description') }}</p>
    </div>

    <!-- 表单主体 -->
    <form class="flex flex-col gap-3" novalidate @submit.prevent="form.handleSubmit">
      <FieldGroup class="gap-3">
        <!-- 邮箱输入框 -->
        <form.Field name="email" :validators="fieldValidators.email">
          <template #default="{ field, state }">
            <Field :data-invalid="state.meta.errors.length > 0">
              <FieldLabel :for="field.name" class="sr-only">
                {{ $t('loginForm.emailLabel') }}
              </FieldLabel>
              <div class="relative group">
                <div
                  class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-muted-foreground group-focus-within:text-primary transition-colors"
                >
                  <MailIcon class="w-4 h-4" />
                </div>
                <input
                  :id="field.name"
                  :value="field.state.value"
                  type="email"
                  autocomplete="email"
                  :placeholder="$t('loginForm.emailPlaceholder')"
                  class="w-full h-11 pl-10 pr-3.5 rounded-xl bg-muted/60 border border-input aria-[invalid=true]:border-destructive/60 text-xs sm:text-sm text-foreground placeholder:text-muted-foreground focus:bg-background focus:border-primary focus:ring-4 focus:ring-primary/20 focus:outline-none transition-all duration-200"
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

        <!-- 密码输入框 -->
        <form.Field name="password" :validators="fieldValidators.password">
          <template #default="{ field, state }">
            <Field :data-invalid="state.meta.errors.length > 0">
              <FieldLabel :for="field.name" class="sr-only">
                {{ $t('loginForm.passwordLabel') }}
              </FieldLabel>
              <div class="relative group">
                <div
                  class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-muted-foreground group-focus-within:text-primary transition-colors"
                >
                  <LockIcon class="w-4 h-4" />
                </div>
                <input
                  :id="field.name"
                  :value="field.state.value"
                  :type="showPassword ? 'text' : 'password'"
                  autocomplete="current-password"
                  :placeholder="$t('loginForm.passwordPlaceholder')"
                  class="w-full h-11 pl-10 pr-10 rounded-xl bg-muted/60 border border-input aria-[invalid=true]:border-destructive/60 text-xs sm:text-sm text-foreground placeholder:text-muted-foreground focus:bg-background focus:border-primary focus:ring-4 focus:ring-primary/20 focus:outline-none transition-all duration-200"
                  :aria-invalid="state.meta.errors.length > 0"
                  @input="field.handleChange(($event.target as HTMLInputElement).value)"
                  @blur="field.handleBlur"
                />
                <button
                  type="button"
                  tabindex="-1"
                  class="absolute inset-y-0 right-0 pr-3 flex items-center text-muted-foreground hover:text-foreground transition-colors focus:outline-none cursor-pointer"
                  :aria-label="
                    showPassword ? $t('loginForm.hidePassword') : $t('loginForm.showPassword')
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
      </FieldGroup>

      <!-- 记住我与忘记密码 -->
      <div class="flex items-center justify-between text-xs pt-0.5">
        <div class="flex items-center gap-1.5">
          <Checkbox
            id="remember-me"
            v-model="rememberMe"
            class="rounded border-input data-[state=checked]:bg-primary data-[state=checked]:border-primary"
          />
          <Label
            for="remember-me"
            class="text-xs font-normal text-muted-foreground cursor-pointer select-none"
          >
            {{ $t('loginForm.rememberMe') }}
          </Label>
        </div>
        <ToForgotPasswordLink
          class="text-xs font-medium text-primary hover:text-primary/80 hover:underline cursor-pointer"
        />
      </div>

      <!-- 错误提示 -->
      <div
        v-if="submitError"
        class="animate-auth-feedback p-2.5 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs motion-reduce:animate-none"
      >
        {{ submitError }}
      </div>

      <!-- 渐变提交按钮 -->
      <Button
        type="submit"
        class="w-full h-11 rounded-xl text-sm font-semibold text-primary-foreground bg-primary shadow-md shadow-primary/25 hover:bg-primary/90 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary/30 active:translate-y-0 active:scale-[0.99] transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-70 disabled:hover:translate-y-0 mt-1"
        :disabled="loading"
      >
        <Spinner v-if="loading" class="w-4 h-4 text-primary-foreground" />
        <span v-else class="flex items-center gap-1.5">
          {{ $t('loginForm.submit') }}
          <ArrowRightIcon class="w-4 h-4" />
        </span>
      </Button>

      <!-- 底部跳转注册 -->
      <div class="mt-2.5 pt-2.5 border-t border-border text-center text-xs text-muted-foreground">
        <span>{{ $t('loginForm.noAccount') }}</span>
        <button
          type="button"
          class="font-semibold text-primary hover:text-primary/80 hover:underline cursor-pointer transition-colors"
          @click="router.push('/auth/sign-up')"
        >
          {{ $t('loginForm.signUp') }}
        </button>
      </div>
    </form>
  </div>
</template>
