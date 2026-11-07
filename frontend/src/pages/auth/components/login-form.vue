<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { useAuth } from '@/composables/use-auth'
import { ApiError } from '@/lib/api-response'
import { loginSchema, type LoginFormValues } from '@/validators/auth.schema'
import { ArrowRightIcon, EyeIcon, EyeOffIcon, LockIcon, MailIcon } from '@lucide/vue'
import { useForm } from '@tanstack/vue-form'
import { ref } from 'vue'
import { useRouter } from 'vue-router'

import ToForgotPasswordLink from './to-forgot-password-link.vue'

const router = useRouter()
const { login } = useAuth()

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

const form = useForm({
  defaultValues: { email: '', password: '' } satisfies LoginFormValues,
  validators: {
    onChange: loginSchema,
    onBlur: loginSchema,
    onSubmit: loginSchema,
  },
  onSubmit: async ({ value }) => {
    if (loading.value) return

    loading.value = true
    submitError.value = ''

    try {
      await login(value)
    } catch (error) {
      submitError.value = resolveErrorMessage(error, '登录失败，请核对账号与密码')
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
        <span>WELCOME BACK</span>
        <span class="w-2.5 h-[2px] bg-primary rounded-full" />
      </div>
    </div>

    <!-- 标题与副标题 -->
    <div class="mb-4">
      <h2 class="text-xl sm:text-2xl font-extrabold tracking-tight text-card-foreground">
        Sign In to Your Account
      </h2>
      <p class="text-xs text-muted-foreground mt-1">Enter your email and password to continue</p>
    </div>

    <!-- 表单主体 -->
    <form class="flex flex-col gap-3" novalidate @submit.prevent="form.handleSubmit">
      <FieldGroup class="gap-3">
        <!-- 邮箱输入框 -->
        <form.Field name="email">
          <template #default="{ field, state }">
            <Field :data-invalid="state.meta.errors.length > 0">
              <FieldLabel :for="field.name" class="sr-only">Email address</FieldLabel>
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
                  placeholder="Email address"
                  class="w-full h-11 pl-10 pr-3.5 rounded-xl bg-muted/60 border border-input text-xs sm:text-sm text-foreground placeholder:text-muted-foreground focus:bg-background focus:border-primary focus:ring-4 focus:ring-primary/20 focus:outline-none transition-all duration-200"
                  :aria-invalid="state.meta.errors.length > 0"
                  @input="field.handleChange(($event.target as HTMLInputElement).value)"
                  @blur="field.handleBlur"
                />
              </div>
              <FieldError :errors="state.meta.errors" />
            </Field>
          </template>
        </form.Field>

        <!-- 密码输入框 -->
        <form.Field name="password">
          <template #default="{ field, state }">
            <Field :data-invalid="state.meta.errors.length > 0">
              <FieldLabel :for="field.name" class="sr-only">Password</FieldLabel>
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
                  placeholder="Password"
                  class="w-full h-11 pl-10 pr-10 rounded-xl bg-muted/60 border border-input text-xs sm:text-sm text-foreground placeholder:text-muted-foreground focus:bg-background focus:border-primary focus:ring-4 focus:ring-primary/20 focus:outline-none transition-all duration-200"
                  :aria-invalid="state.meta.errors.length > 0"
                  @input="field.handleChange(($event.target as HTMLInputElement).value)"
                  @blur="field.handleBlur"
                />
                <button
                  type="button"
                  tabindex="-1"
                  class="absolute inset-y-0 right-0 pr-3 flex items-center text-muted-foreground hover:text-foreground transition-colors focus:outline-none cursor-pointer"
                  :aria-label="showPassword ? '隐藏密码' : '显示密码'"
                  @click="showPassword = !showPassword"
                >
                  <EyeOffIcon v-if="showPassword" class="w-4 h-4" />
                  <EyeIcon v-else class="w-4 h-4" />
                </button>
              </div>
              <FieldError :errors="state.meta.errors" />
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
            Remember me
          </Label>
        </div>
        <ToForgotPasswordLink
          class="text-xs font-medium text-primary hover:text-primary/80 hover:underline cursor-pointer"
        />
      </div>

      <!-- 错误提示 -->
      <div
        v-if="submitError"
        class="p-2.5 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-xs"
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
          Sign In
          <ArrowRightIcon class="w-4 h-4" />
        </span>
      </Button>

      <!-- 底部跳转注册 -->
      <div class="mt-2.5 pt-2.5 border-t border-border text-center text-xs text-muted-foreground">
        <span>Don't have an account? </span>
        <button
          type="button"
          class="font-semibold text-primary hover:text-primary/80 hover:underline cursor-pointer transition-colors"
          @click="router.push('/auth/sign-up')"
        >
          Sign Up
        </button>
      </div>
    </form>
  </div>
</template>
