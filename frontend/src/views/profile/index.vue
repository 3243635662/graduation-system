<script setup lang="ts">
/**
 * 个人中心 /profile
 *
 * 布局：顶部身份名片 → 下方左（个人资料）/ 右（账号安全）两列。
 * 账号安全内用 Tabs 区分「修改密码」与「换绑邮箱」，
 * 换绑邮箱按 验证密码 → 解绑原邮箱 → 验证新邮箱 → 完成绑定 四步推进。
 */
import { BasicPage } from '@/components/global-layout'
import StatusBadge from '@/components/status-badge.vue'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import {
  Stepper,
  StepperIndicator,
  StepperItem,
  StepperSeparator,
  StepperTitle,
  StepperTrigger,
} from '@/components/ui/stepper'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useEmailCode } from '@/composables/use-email-code'
import { useSubmitAction } from '@/composables/use-submit-action'
import { USER_STATUS_LABEL, USER_STATUS_TONE } from '@/constants/rbac-labels'
import { ApiError } from '@/lib/api-response'
import {
  bindEmail,
  sendBindEmailCode,
  sendResetPasswordCode,
  unbindEmail,
  verifyEmailChangePassword,
} from '@/services/api/auth.api'
import { useAuthStore } from '@/stores/auth'
import {
  bindEmailSchema,
  emailChangePasswordSchema,
  profileSchema,
  resetPasswordSchema,
  sendEmailCodeSchema,
} from '@/validators/auth.schema'
import { firstIssueMessage } from '@/validators/rbac.schema'
import type { UpdateMyProfileInput } from '@graduation/shared'
import {
  AlertCircleIcon,
  ArrowRightIcon,
  CheckCircle2Icon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  KeyRoundIcon,
  LockIcon,
  MailIcon,
  MailWarningIcon,
  PhoneIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SaveIcon,
  ShieldCheckIcon,
  UserRoundIcon,
} from '@lucide/vue'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'

type EmailStep = 1 | 2 | 3 | 4

const emailSteps = ref([
  { step: 1, title: '验证密码' },
  { step: 2, title: '解绑原邮箱' },
  { step: 3, title: '验证新邮箱' },
  { step: 4, title: '完成绑定' },
])

const authStore = useAuthStore()
const router = useRouter()
const { t, te } = useI18n()

const { submitting: savingProfile, submit: submitProfile } = useSubmitAction()
const { submitting: resettingPassword, submit: submitPassword } = useSubmitAction()
const { submitting: refreshingUser, submit: submitRefreshUser } = useSubmitAction()
const { submitting: verifyingPassword, submit: submitVerifyPassword } = useSubmitAction()
const { submitting: unbindingEmail, submit: submitUnbindEmail } = useSubmitAction()
const { submitting: bindingEmail, submit: submitBindEmail } = useSubmitAction()

const pwdCode = useEmailCode(sendResetPasswordCode)
let bindSendError: unknown = null
const bindCode = useEmailCode(async (email: string) => {
  bindSendError = null

  try {
    return await sendBindEmailCode({ email, changeToken: emailChangeToken.value })
  } catch (error) {
    bindSendError = error
    if (isTokenError(error)) resetEmailChangeFlow()
    throw error
  }
})

/** 组合式函数返回的 ref 在模板中需顶层解包，这里统一给出模板别名 */
const pwdSending = pwdCode.sending
const pwdSecondsLeft = pwdCode.secondsLeft
const pwdSent = pwdCode.sent
const pwdCanSend = pwdCode.canSend
const bindSending = bindCode.sending
const bindSecondsLeft = bindCode.secondsLeft
const bindSent = bindCode.sent

// ── 个人资料表单 ────────────────────────────────────────
const realName = ref('')
const phone = ref('')
const avatarUrl = ref('')

// ── 修改密码表单 ────────────────────────────────────────
const pwdCodeValue = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const showNewPwd = ref(false)
const showConfirmPwd = ref(false)

// ── 换绑邮箱流程 ────────────────────────────────────────
const emailStep = ref<EmailStep>(1)
const emailChangeToken = ref('')
const hadBoundEmail = ref(false)
const currentPassword = ref('')
const showCurrentPassword = ref(false)
const newEmail = ref('')
const bindCodeValue = ref('')
const tokenExpiresAt = ref(0)
const nowTs = ref(Date.now())
let expiryTimer: ReturnType<typeof setTimeout> | null = null
let tickTimer: ReturnType<typeof setInterval> | null = null

const tokenSecondsLeft = computed(() =>
  tokenExpiresAt.value ? Math.max(0, Math.ceil((tokenExpiresAt.value - nowTs.value) / 1000)) : 0,
)

// ── 复制状态微动效 ──────────────────────────────────────
const copied = ref(false)
let copyTimer: ReturnType<typeof setTimeout> | null = null

// ── 身份编号识别（学号 / 工号 / 系统编号） ───────────────
const userIdentifier = computed(() => {
  const u = authStore.user
  if (!u) {
    return {
      label: '编号',
      value: '—',
      secondary: null,
      copyLabel: '编号',
      canCopy: false,
      isPlaceholder: false,
      fullCopyValue: '',
    }
  }

  const isStudentRole = u.roles?.some((r) => r.code === 'STUDENT' || r.name.includes('学生'))
  const isTeacherRole = u.roles?.some(
    (r) => r.code === 'TEACHER' || r.name.includes('教师') || r.name.includes('导师'),
  )

  if (u.studentNo || isStudentRole) {
    const hasNo = Boolean(u.studentNo)
    return {
      label: '学号',
      value: u.studentNo || '未录入学号',
      secondary: u.className || (hasNo ? '学生档案' : '请联系教务管理员录入学籍'),
      copyLabel: '学号',
      canCopy: hasNo,
      isPlaceholder: !hasNo,
      fullCopyValue: u.studentNo || '',
    }
  }

  if (u.teacherNo || isTeacherRole) {
    const hasNo = Boolean(u.teacherNo)
    const parts = [u.organizationName, u.title].filter(Boolean)
    return {
      label: '工号',
      value: u.teacherNo || '未录入工号',
      secondary:
        parts.length > 0 ? parts.join(' · ') : hasNo ? '教工档案' : '请联系管理员录入人事档案',
      copyLabel: '工号',
      canCopy: hasNo,
      isPlaceholder: !hasNo,
      fullCopyValue: u.teacherNo || '',
    }
  }

  const roleNames = u.roles?.map((r) => r.name).join(' · ') || '系统账号'
  const shortId = u.id ? `${u.id.slice(0, 8)}...` : '—'
  return {
    label: '账号标识',
    value: shortId,
    secondary: roleNames,
    copyLabel: '用户编号',
    canCopy: Boolean(u.id),
    isPlaceholder: false,
    fullCopyValue: u.id,
  }
})

async function copyIdentifier() {
  const item = userIdentifier.value
  if (!item.canCopy) {
    toast.info(`${item.label}暂未录入，无法复制`)
    return
  }
  const textToCopy = item.fullCopyValue || item.value
  if (!textToCopy || textToCopy === '—') return
  try {
    await navigator.clipboard.writeText(textToCopy)
    copied.value = true
    if (copyTimer) clearTimeout(copyTimer)
    copyTimer = setTimeout(() => {
      copied.value = false
    }, 1800)
    toast.success(`${item.copyLabel}已复制`)
  } catch {
    toast.error('复制失败，请手动选择复制')
  }
}

async function handleRefreshUser() {
  await submitRefreshUser(() => authStore.fetchMe(), {
    success: '已同步最新档案与角色信息',
  })
}

function formatMsg(msg: string) {
  return te(msg) ? t(msg) : msg
}

onMounted(async () => {
  try {
    await authStore.fetchMe()
  } catch {
    /* silent */
  }
})

watch(
  () => authStore.user,
  (u) => {
    if (u) {
      realName.value = u.realName ?? ''
      phone.value = u.phone ?? ''
      avatarUrl.value = u.avatarUrl ?? ''
    }
  },
  { immediate: true },
)

watch(newEmail, () => {
  bindCodeValue.value = ''
  bindCode.reset()
})

onUnmounted(() => {
  if (copyTimer) clearTimeout(copyTimer)
  clearChangeTimers()
})

// ── 资料预览与脏检查 ────────────────────────────────────
const previewName = computed(
  () => realName.value.trim() || authStore.user?.realName || '未设置姓名',
)
const previewAvatar = computed(() => avatarUrl.value.trim() || authStore.user?.avatarUrl || '')
const avatarFallback = computed(() => {
  const n = previewName.value
  if (!n || n === '未设置姓名') return 'U'
  return /^[\u4e00-\u9fa5]+$/.test(n) ? n.slice(-2) : n.slice(0, 2).toUpperCase()
})
const isDirty = computed(
  () =>
    realName.value !== (authStore.user?.realName ?? '') ||
    phone.value !== (authStore.user?.phone ?? '') ||
    avatarUrl.value !== (authStore.user?.avatarUrl ?? ''),
)

// ── 修改密码 ────────────────────────────────────────────
const pwdStrength = computed(() => {
  const p = newPassword.value
  if (!p) return 0
  let s = 0
  if (p.length >= 8) s++
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++
  if (/\d/.test(p)) s++
  if (/[^a-zA-Z0-9]/.test(p)) s++
  return s
})
const strengthMeta = computed(() => {
  return [
    { label: '—', bar: 'bg-muted', text: 'text-muted-foreground' },
    { label: '较弱', bar: 'bg-destructive', text: 'text-destructive' },
    { label: '一般', bar: 'bg-amber-500', text: 'text-amber-500' },
    { label: '良好', bar: 'bg-blue-500', text: 'text-blue-500' },
    { label: '强', bar: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' },
  ][pwdStrength.value]
})
const currentUser = computed(() => authStore.user)
const boundEmail = computed(() => currentUser.value?.email ?? '')
const hasBoundEmail = computed(() => Boolean(boundEmail.value))
const canSubmitPwd = computed(
  () =>
    !resettingPassword.value &&
    hasBoundEmail.value &&
    pwdCodeValue.value.length === 6 &&
    newPassword.value.length >= 8 &&
    newPassword.value === confirmPassword.value,
)

// ── 换绑邮箱计算状态 ────────────────────────────────────
const canVerifyPassword = computed(
  () =>
    !verifyingPassword.value && emailChangePasswordSchema.safeParse(currentPassword.value).success,
)
const canSendBindCode = computed(
  () =>
    Boolean(emailChangeToken.value) &&
    bindCode.canSend.value &&
    sendEmailCodeSchema.safeParse({ email: newEmail.value }).success,
)
const canBindEmail = computed(
  () =>
    Boolean(emailChangeToken.value) &&
    !bindingEmail.value &&
    bindEmailSchema.safeParse({ email: newEmail.value, emailCode: bindCodeValue.value }).success,
)

function isTokenError(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 40014 || error.code === 40015)
}

function clearChangeTimers(): void {
  if (expiryTimer) clearTimeout(expiryTimer)
  if (tickTimer) clearInterval(tickTimer)
  expiryTimer = null
  tickTimer = null
  tokenExpiresAt.value = 0
}

function resetEmailChangeFlow(message?: string): void {
  clearChangeTimers()
  emailChangeToken.value = ''
  currentPassword.value = ''
  showCurrentPassword.value = false
  newEmail.value = ''
  bindCodeValue.value = ''
  bindCode.reset()
  emailStep.value = 1
  if (message) toast.info(message)
}

function startChangeTimers(seconds: number): void {
  clearChangeTimers()
  nowTs.value = Date.now()
  tokenExpiresAt.value = nowTs.value + seconds * 1000
  expiryTimer = setTimeout(
    () => resetEmailChangeFlow('验证已过期，请重新验证当前密码'),
    seconds * 1000,
  )
  tickTimer = setInterval(() => {
    nowTs.value = Date.now()
  }, 1000)
}

// ── 操作 ────────────────────────────────────────────────
function handleReset() {
  realName.value = authStore.user?.realName ?? ''
  phone.value = authStore.user?.phone ?? ''
  avatarUrl.value = authStore.user?.avatarUrl ?? ''
  toast.info('已还原为保存的数据')
}

async function handleSaveProfile() {
  const parsed = profileSchema.safeParse({
    realName: realName.value,
    phone: phone.value,
    avatarUrl: avatarUrl.value,
  })
  if (!parsed.success) {
    toast.error(formatMsg(firstIssueMessage(parsed.error)))
    return
  }
  const payload: UpdateMyProfileInput = {
    ...(parsed.data.realName ? { realName: parsed.data.realName } : {}),
    phone: parsed.data.phone || null,
    avatarUrl: parsed.data.avatarUrl || null,
  }
  await submitProfile(() => authStore.updateProfile(payload), { success: '个人资料已保存' })
}

async function handleSendCode() {
  const email = authStore.user?.email
  if (!email) {
    toast.info('当前未绑定邮箱，请先在「换绑邮箱」中完成绑定')
    return
  }
  const ok = await pwdCode.send(email)
  if (ok) toast.success(`验证码已发送至 ${email}`)
  else if (pwdCode.errorKey.value) toast.error(formatMsg(pwdCode.errorKey.value))
}

async function handleSavePwd() {
  const email = authStore.user?.email
  if (!email) {
    toast.info('当前未绑定邮箱，请先在「换绑邮箱」中完成绑定')
    return
  }
  const parsed = resetPasswordSchema.safeParse({
    email,
    emailCode: pwdCodeValue.value,
    password: newPassword.value,
    confirmPassword: confirmPassword.value,
  })
  if (!parsed.success) {
    toast.error(formatMsg(firstIssueMessage(parsed.error)))
    return
  }
  await submitPassword(async () => {
    await authStore.resetPassword({
      email,
      emailCode: parsed.data.emailCode,
      password: parsed.data.password,
      confirmPassword: parsed.data.confirmPassword,
    })
    toast.success('密码已更新，请重新登录')
    pwdCodeValue.value = ''
    newPassword.value = ''
    confirmPassword.value = ''
    pwdCode.reset()
    setTimeout(() => router.push('/auth/sign-in'), 1500)
  })
}

async function handleVerifyPassword() {
  const parsed = emailChangePasswordSchema.safeParse(currentPassword.value)
  if (!parsed.success) {
    toast.error(formatMsg(firstIssueMessage(parsed.error)))
    return
  }

  const ok = await submitVerifyPassword(
    async () => {
      const result = await verifyEmailChangePassword(parsed.data)
      emailChangeToken.value = result.changeToken
      hadBoundEmail.value = Boolean(authStore.user?.email)
      emailStep.value = hadBoundEmail.value ? 2 : 3
      startChangeTimers(result.expiresIn)
    },
    { success: '身份验证通过，请继续换绑邮箱' },
  )

  if (!ok) currentPassword.value = ''
}

async function handleUnbindEmail() {
  await submitUnbindEmail(
    async () => {
      await unbindEmail({ changeToken: emailChangeToken.value })
      const userBeforeUnbind = authStore.user
      if (userBeforeUnbind) authStore.setUser({ ...userBeforeUnbind, email: null })
      void authStore.fetchMe().catch(() => undefined)
      emailStep.value = 3
    },
    { success: '原邮箱已解绑，请填写新邮箱' },
  )
}

async function handleSendBindCode() {
  const parsed = sendEmailCodeSchema.safeParse({ email: newEmail.value })
  if (!parsed.success) {
    toast.error(formatMsg(firstIssueMessage(parsed.error)))
    return
  }
  const ok = await bindCode.send(parsed.data.email)
  if (ok) toast.success(`验证码已发送至 ${parsed.data.email}`)
  else if (bindSendError instanceof ApiError) toast.error(bindSendError.message)
  else if (bindCode.errorKey.value) toast.error(formatMsg(bindCode.errorKey.value))
}

async function handleBindEmail() {
  const parsed = bindEmailSchema.safeParse({
    email: newEmail.value,
    emailCode: bindCodeValue.value,
  })
  if (!parsed.success) {
    toast.error(formatMsg(firstIssueMessage(parsed.error)))
    return
  }

  await submitBindEmail(
    async () => {
      try {
        const nextUser = await bindEmail({
          email: parsed.data.email,
          emailCode: parsed.data.emailCode,
          changeToken: emailChangeToken.value,
        })
        authStore.setUser(nextUser)
        clearChangeTimers()
        emailChangeToken.value = ''
        hadBoundEmail.value = false
        currentPassword.value = ''
        emailStep.value = 4
      } catch (error) {
        if (isTokenError(error)) resetEmailChangeFlow()
        throw error
      }
    },
    { success: '新邮箱绑定成功' },
  )
}
</script>

<template>
  <BasicPage title="个人中心" description="集中管理个人资料、登录密码与绑定邮箱。">
    <div class="flex max-w-5xl flex-col gap-6">
      <!-- 顶部身份名片 -->
      <Card class="border shadow-xs">
        <CardContent class="p-5">
          <div class="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div class="flex min-w-0 items-center gap-4">
              <Avatar class="size-14 shrink-0 rounded-full ring-1 ring-border">
                <AvatarImage :src="previewAvatar" :alt="previewName" class="object-cover" />
                <AvatarFallback
                  class="bg-primary/10 text-sm font-semibold text-primary dark:bg-primary/20"
                >
                  {{ avatarFallback }}
                </AvatarFallback>
              </Avatar>

              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="truncate text-base font-semibold text-foreground">{{
                    previewName
                  }}</span>
                  <span
                    v-if="isDirty"
                    class="shrink-0 rounded-full border border-amber-500/20 bg-amber-500/10 px-1.5 py-px text-[10px] font-medium leading-tight text-amber-600 dark:text-amber-400"
                    >未保存</span
                  >
                </div>
                <div class="mt-0.5 flex items-center gap-1.5 text-xs">
                  <MailIcon class="size-3.5 shrink-0 text-muted-foreground" />
                  <span
                    class="truncate font-mono"
                    :class="
                      hasBoundEmail ? 'text-muted-foreground' : 'text-amber-600 dark:text-amber-400'
                    "
                    >{{ boundEmail || '未绑定邮箱' }}</span
                  >
                </div>
                <div class="mt-2 flex flex-wrap items-center gap-1.5">
                  <StatusBadge
                    v-if="currentUser"
                    :label="USER_STATUS_LABEL[currentUser.status]"
                    :tone="USER_STATUS_TONE[currentUser.status]"
                  />
                  <template v-if="currentUser?.roles?.length">
                    <span class="text-xs text-border">·</span>
                    <Badge
                      v-for="role in currentUser.roles"
                      :key="role.id"
                      variant="outline"
                      class="h-5 border-primary/25 bg-primary/5 px-1.5 text-[11px] font-normal text-primary dark:bg-primary/10"
                    >
                      {{
                        role.scopeOrgUnitName
                          ? `${role.name} · ${role.scopeOrgUnitName}`
                          : role.name
                      }}
                    </Badge>
                  </template>
                </div>
              </div>
            </div>

            <div
              class="flex shrink-0 items-center justify-between gap-2 border-t border-border/60 pt-3 sm:justify-end sm:border-0 sm:pt-0"
            >
              <div
                class="flex flex-col items-start justify-center rounded-lg border bg-muted/30 px-3 py-1.5 transition-colors hover:bg-muted/50 sm:items-end sm:text-right"
              >
                <div class="flex items-center gap-1.5">
                  <span class="text-[11px] font-medium text-muted-foreground">{{
                    userIdentifier.label
                  }}</span>
                  <span
                    class="font-mono text-xs font-semibold tracking-tight"
                    :class="
                      userIdentifier.isPlaceholder
                        ? 'font-normal italic text-muted-foreground'
                        : 'text-foreground'
                    "
                    >{{ userIdentifier.value }}</span
                  >
                  <Button
                    v-if="userIdentifier.canCopy"
                    variant="ghost"
                    size="icon"
                    class="ml-0.5 size-5 cursor-pointer text-muted-foreground transition-transform hover:text-foreground active:scale-90"
                    :title="`复制${userIdentifier.copyLabel}`"
                    @click="copyIdentifier"
                  >
                    <CheckCircle2Icon
                      v-if="copied"
                      class="size-3.5 text-emerald-600 dark:text-emerald-400"
                    />
                    <CopyIcon v-else class="size-3.5" />
                  </Button>
                </div>
                <span
                  v-if="userIdentifier.secondary"
                  class="mt-0.5 text-[10px] font-normal tracking-tight text-muted-foreground/80"
                >
                  {{ userIdentifier.secondary }}
                </span>
              </div>

              <Button
                variant="outline"
                size="icon"
                class="size-8 shrink-0 cursor-pointer text-muted-foreground hover:text-foreground"
                :disabled="refreshingUser"
                title="重新同步最新档案与角色信息"
                @click="handleRefreshUser"
              >
                <RefreshCwIcon class="size-3.5" :class="{ 'animate-spin': refreshingUser }" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <!-- 内容区：左个人资料 / 右账号安全 -->
      <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <!-- 个人资料 -->
        <Card class="border shadow-xs">
          <CardHeader>
            <div class="flex items-center gap-2">
              <UserRoundIcon class="size-4 text-muted-foreground" />
              <CardTitle class="text-sm font-semibold">个人资料</CardTitle>
            </div>
            <CardDescription class="mt-1 text-xs">
              维护真实姓名、联系方式与头像，修改会实时反映在上方名片。
            </CardDescription>
          </CardHeader>

          <Separator />

          <CardContent class="flex flex-col gap-5 pt-5">
            <div class="flex flex-col gap-1.5">
              <Label for="f-name" class="text-xs font-medium">
                真实姓名 <span class="ml-0.5 text-destructive">*</span>
              </Label>
              <Input id="f-name" v-model="realName" placeholder="与学籍 / 人事档案一致" />
              <p class="text-[11px] text-muted-foreground">用于课题申报、论文评审与记录署名。</p>
            </div>

            <div class="flex flex-col gap-1.5">
              <Label for="f-phone" class="text-xs font-medium">
                联系电话 <span class="ml-1 font-normal text-muted-foreground">（选填）</span>
              </Label>
              <div class="relative">
                <PhoneIcon
                  class="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                />
                <Input id="f-phone" v-model="phone" placeholder="13800000000" class="pl-8" />
              </div>
              <p class="text-[11px] text-muted-foreground">留空保存即可解绑手机号。</p>
            </div>

            <div class="flex flex-col gap-1.5">
              <Label for="f-avatar" class="text-xs font-medium">
                头像链接 <span class="ml-1 font-normal text-muted-foreground">（选填）</span>
              </Label>
              <Input
                id="f-avatar"
                v-model="avatarUrl"
                placeholder="https://..."
                class="font-mono text-xs"
              />
              <p class="text-[11px] text-muted-foreground">
                支持标准 http(s) 图片链接，留空则自动生成首字头像。
              </p>
            </div>

            <div class="flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2.5 text-xs">
              <MailIcon class="size-3.5 shrink-0 text-muted-foreground" />
              <span class="text-muted-foreground">绑定邮箱</span>
              <span class="min-w-0 flex-1 truncate font-mono font-medium text-foreground">
                {{ boundEmail || '未绑定' }}
              </span>
              <Badge
                v-if="!hasBoundEmail"
                variant="outline"
                class="border-amber-500/30 text-[10px] text-amber-600 dark:text-amber-400"
              >
                待绑定
              </Badge>
            </div>
          </CardContent>

          <Separator />

          <CardFooter class="flex items-center justify-between py-4">
            <Button
              variant="ghost"
              size="sm"
              class="h-8 cursor-pointer gap-1.5 text-xs text-muted-foreground"
              :disabled="savingProfile || !isDirty"
              @click="handleReset"
            >
              <RotateCcwIcon class="size-3.5" />
              放弃修改
            </Button>
            <Button
              size="sm"
              class="h-8 gap-1.5 text-xs"
              :disabled="savingProfile || !isDirty"
              @click="handleSaveProfile"
            >
              <Spinner v-if="savingProfile" />
              <SaveIcon v-else class="size-3.5" />
              {{ savingProfile ? '保存中…' : '保存更改' }}
            </Button>
          </CardFooter>
        </Card>

        <!-- 账号安全 -->
        <Card class="border shadow-xs">
          <CardHeader>
            <div class="flex items-center gap-2">
              <ShieldCheckIcon class="size-4 text-muted-foreground" />
              <CardTitle class="text-sm font-semibold">账号安全</CardTitle>
            </div>
            <CardDescription class="mt-1 text-xs">
              密码与邮箱是账号身份的核心凭证，请在此统一管理。
            </CardDescription>
          </CardHeader>

          <Tabs default-value="password">
            <div class="px-6">
              <TabsList class="grid w-full grid-cols-2">
                <TabsTrigger value="password">修改密码</TabsTrigger>
                <TabsTrigger value="email">换绑邮箱</TabsTrigger>
              </TabsList>
            </div>

            <!-- 修改密码 -->
            <TabsContent value="password" class="mt-0">
              <Separator />
              <CardContent class="flex flex-col gap-5 pt-5">
                <div class="flex flex-col gap-1.5">
                  <Label class="text-xs font-medium">核验邮箱</Label>
                  <div class="flex items-center gap-2">
                    <div class="relative min-w-0 flex-1">
                      <MailIcon
                        class="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                      />
                      <Input
                        :model-value="boundEmail"
                        disabled
                        class="bg-muted/40 pl-8 font-mono text-xs text-muted-foreground"
                      />
                    </div>
                    <div
                      v-if="hasBoundEmail"
                      class="flex shrink-0 items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400"
                    >
                      <ShieldCheckIcon class="size-3.5" />
                      <span>已验证</span>
                    </div>
                    <div
                      v-else
                      class="flex shrink-0 items-center gap-1 text-xs text-amber-600 dark:text-amber-400"
                    >
                      <MailWarningIcon class="size-3.5" />
                      <span>待绑定</span>
                    </div>
                  </div>
                  <p v-if="!hasBoundEmail" class="text-[11px] text-muted-foreground">
                    当前邮箱已解绑，无法接收改密验证码。请先在「换绑邮箱」中完成绑定。
                  </p>
                </div>

                <div class="flex flex-col gap-1.5">
                  <Label for="f-code" class="text-xs font-medium">
                    邮箱验证码 <span class="ml-0.5 text-destructive">*</span>
                  </Label>
                  <div class="flex gap-2">
                    <div class="relative min-w-0 flex-1">
                      <KeyRoundIcon
                        class="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                      />
                      <Input
                        id="f-code"
                        v-model="pwdCodeValue"
                        maxlength="6"
                        placeholder="6 位验证码"
                        class="pl-8 font-mono tracking-widest"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      class="h-9 shrink-0 cursor-pointer text-xs"
                      :disabled="!hasBoundEmail || !pwdCanSend"
                      @click="handleSendCode"
                    >
                      <Spinner v-if="pwdSending" />
                      <span v-if="pwdSending">发送中…</span>
                      <span v-else-if="pwdSecondsLeft > 0">{{ pwdSecondsLeft }}s 后重发</span>
                      <span v-else>获取验证码</span>
                    </Button>
                  </div>
                  <p
                    v-if="pwdSent"
                    class="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400"
                  >
                    <CheckCircle2Icon class="size-3" />
                    验证码已发送，请在 120 秒内完成填写
                  </p>
                </div>

                <Separator />

                <div class="flex flex-col gap-1.5">
                  <Label for="f-newpwd" class="text-xs font-medium">
                    新密码 <span class="ml-0.5 text-destructive">*</span>
                  </Label>
                  <div class="relative">
                    <Input
                      id="f-newpwd"
                      v-model="newPassword"
                      :type="showNewPwd ? 'text' : 'password'"
                      placeholder="至少 8 位，建议含大小写与数字"
                      class="pr-9"
                    />
                    <button
                      type="button"
                      class="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
                      @click="showNewPwd = !showNewPwd"
                    >
                      <EyeOffIcon v-if="showNewPwd" class="size-4" />
                      <EyeIcon v-else class="size-4" />
                    </button>
                  </div>
                  <div v-if="newPassword" class="flex flex-col gap-1 pt-0.5">
                    <div class="flex items-center justify-between text-[11px]">
                      <span class="text-muted-foreground">安全强度</span>
                      <span class="font-medium" :class="strengthMeta?.text">{{
                        strengthMeta?.label
                      }}</span>
                    </div>
                    <div class="grid h-1 grid-cols-4 gap-1">
                      <div
                        v-for="i in 4"
                        :key="i"
                        class="rounded-full transition-colors duration-200"
                        :class="i <= pwdStrength ? strengthMeta?.bar : 'bg-muted'"
                      />
                    </div>
                  </div>
                </div>

                <div class="flex flex-col gap-1.5">
                  <Label for="f-confirmpwd" class="text-xs font-medium">
                    确认新密码 <span class="ml-0.5 text-destructive">*</span>
                  </Label>
                  <div class="relative">
                    <Input
                      id="f-confirmpwd"
                      v-model="confirmPassword"
                      :type="showConfirmPwd ? 'text' : 'password'"
                      placeholder="再次输入新密码"
                      class="pr-9"
                    />
                    <button
                      type="button"
                      class="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
                      @click="showConfirmPwd = !showConfirmPwd"
                    >
                      <EyeOffIcon v-if="showConfirmPwd" class="size-4" />
                      <EyeIcon v-else class="size-4" />
                    </button>
                  </div>
                  <div class="min-h-[18px] text-[11px]">
                    <p
                      v-if="confirmPassword && newPassword !== confirmPassword"
                      class="flex items-center gap-1 text-destructive"
                    >
                      <AlertCircleIcon class="size-3" />
                      两次输入的密码不一致
                    </p>
                    <p
                      v-else-if="confirmPassword && newPassword === confirmPassword"
                      class="flex items-center gap-1 text-emerald-600 dark:text-emerald-400"
                    >
                      <CheckCircle2Icon class="size-3" />
                      密码一致
                    </p>
                  </div>
                </div>
              </CardContent>

              <Separator />

              <CardFooter class="flex items-center justify-between py-4">
                <span class="text-[11px] text-muted-foreground">修改后需重新登录</span>
                <Button
                  size="sm"
                  class="h-8 cursor-pointer gap-1.5 text-xs"
                  :disabled="!canSubmitPwd"
                  @click="handleSavePwd"
                >
                  <Spinner v-if="resettingPassword" />
                  <LockIcon v-else class="size-3.5" />
                  {{ resettingPassword ? '提交中…' : '更新密码' }}
                </Button>
              </CardFooter>
            </TabsContent>

            <!-- 换绑邮箱 -->
            <TabsContent value="email" class="mt-0">
              <Separator />

              <CardContent class="flex flex-col gap-5 pt-5">
                <!-- 流程进度 -->
                <Stepper :model-value="emailStep" class="w-full py-1">
                  <StepperItem
                    v-for="(item, index) in emailSteps"
                    :key="item.step"
                    :step="item.step"
                    class="min-w-0 flex-1"
                  >
                    <StepperTrigger class="w-full">
                      <StepperIndicator class="size-7 text-[11px]">{{
                        item.step
                      }}</StepperIndicator>
                      <StepperTitle
                        class="max-w-20 truncate text-[11px] font-medium text-muted-foreground"
                      >
                        {{ item.title }}
                      </StepperTitle>
                    </StepperTrigger>
                    <StepperSeparator
                      v-if="index < emailSteps.length - 1"
                      class="mt-3.5 h-px flex-1 self-start"
                    />
                  </StepperItem>
                </Stepper>

                <Alert v-if="emailChangeToken" class="border-primary/20 bg-primary/5 py-2.5">
                  <ShieldCheckIcon />
                  <AlertDescription class="text-xs">
                    身份已验证，请在
                    <span class="font-mono font-semibold"
                      >{{ Math.floor(tokenSecondsLeft / 60) }}:{{
                        String(tokenSecondsLeft % 60).padStart(2, '0')
                      }}</span
                    >
                    内完成换绑。
                  </AlertDescription>
                </Alert>

                <Alert v-else-if="!hasBoundEmail" class="border-amber-500/25 bg-amber-500/5 py-2.5">
                  <MailWarningIcon />
                  <AlertDescription class="text-xs">
                    当前账号未绑定邮箱。验证当前密码后即可直接绑定新邮箱，无需执行解绑步骤。
                  </AlertDescription>
                </Alert>

                <!-- 步骤 1：验证当前密码 -->
                <div v-if="emailStep === 1" class="flex flex-col gap-4">
                  <div class="flex flex-col gap-1.5">
                    <Label for="f-current-pwd" class="text-xs font-medium">
                      当前登录密码 <span class="ml-0.5 text-destructive">*</span>
                    </Label>
                    <div class="relative">
                      <Input
                        id="f-current-pwd"
                        v-model="currentPassword"
                        :type="showCurrentPassword ? 'text' : 'password'"
                        placeholder="请输入当前密码以验证身份"
                        class="pr-9"
                        @keyup.enter="canVerifyPassword && handleVerifyPassword()"
                      />
                      <button
                        type="button"
                        class="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
                        @click="showCurrentPassword = !showCurrentPassword"
                      >
                        <EyeOffIcon v-if="showCurrentPassword" class="size-4" />
                        <EyeIcon v-else class="size-4" />
                      </button>
                    </div>
                    <p class="text-[11px] text-muted-foreground">
                      验证通过后获得 10 分钟有效期的换绑凭证。
                    </p>
                  </div>

                  <div class="flex items-center justify-between gap-3">
                    <p class="text-[11px] text-muted-foreground">验证仅用于确认是本人在操作。</p>
                    <Button
                      size="sm"
                      class="h-8 cursor-pointer gap-1.5 text-xs"
                      :disabled="!canVerifyPassword"
                      @click="handleVerifyPassword"
                    >
                      <Spinner v-if="verifyingPassword" />
                      <ShieldCheckIcon v-else class="size-3.5" />
                      {{ verifyingPassword ? '验证中…' : '验证并继续' }}
                    </Button>
                  </div>
                </div>

                <!-- 步骤 2：解绑原邮箱 -->
                <div v-else-if="emailStep === 2" class="flex flex-col gap-4">
                  <div class="flex flex-col gap-1.5 rounded-md border bg-muted/30 px-3 py-3">
                    <span class="text-[11px] font-medium text-muted-foreground"
                      >即将解绑的原邮箱</span
                    >
                    <span class="truncate font-mono text-sm font-medium text-foreground">{{
                      boundEmail
                    }}</span>
                  </div>
                  <Alert class="border-amber-500/25 bg-amber-500/5 py-2.5">
                    <MailWarningIcon />
                    <AlertDescription class="text-xs">
                      解绑后原邮箱将无法用于登录和找回密码。请在凭证有效期内完成新邮箱绑定。
                    </AlertDescription>
                  </Alert>
                  <div class="flex items-center justify-between gap-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      class="h-8 cursor-pointer gap-1.5 text-xs text-muted-foreground"
                      @click="resetEmailChangeFlow()"
                    >
                      <RotateCcwIcon class="size-3.5" />
                      取消换绑
                    </Button>
                    <Button
                      size="sm"
                      class="h-8 cursor-pointer gap-1.5 text-xs"
                      :disabled="unbindingEmail"
                      @click="handleUnbindEmail"
                    >
                      <Spinner v-if="unbindingEmail" />
                      <ArrowRightIcon v-else class="size-3.5" />
                      {{ unbindingEmail ? '解绑中…' : '解绑原邮箱' }}
                    </Button>
                  </div>
                </div>

                <!-- 步骤 3：验证新邮箱并绑定 -->
                <div v-else-if="emailStep === 3" class="flex flex-col gap-4">
                  <div class="flex flex-col gap-1.5">
                    <Label for="f-new-email" class="text-xs font-medium">
                      新邮箱地址 <span class="ml-0.5 text-destructive">*</span>
                    </Label>
                    <div class="relative">
                      <MailIcon
                        class="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                      />
                      <Input
                        id="f-new-email"
                        v-model="newEmail"
                        type="email"
                        placeholder="name@example.com"
                        class="pl-8 font-mono text-xs"
                      />
                    </div>
                    <p class="text-[11px] text-muted-foreground">
                      该邮箱将作为新的登录标识，不能与其他账号重复。
                    </p>
                  </div>

                  <div class="flex flex-col gap-1.5">
                    <Label for="f-bind-code" class="text-xs font-medium">
                      邮箱验证码 <span class="ml-0.5 text-destructive">*</span>
                    </Label>
                    <div class="flex gap-2">
                      <div class="relative min-w-0 flex-1">
                        <KeyRoundIcon
                          class="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                        />
                        <Input
                          id="f-bind-code"
                          v-model="bindCodeValue"
                          maxlength="6"
                          placeholder="6 位验证码"
                          class="pl-8 font-mono tracking-widest"
                        />
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        class="h-9 shrink-0 cursor-pointer text-xs"
                        :disabled="!canSendBindCode"
                        @click="handleSendBindCode"
                      >
                        <Spinner v-if="bindSending" />
                        <span v-if="bindSending">发送中…</span>
                        <span v-else-if="bindSecondsLeft > 0">{{ bindSecondsLeft }}s 后重发</span>
                        <span v-else>获取验证码</span>
                      </Button>
                    </div>
                    <p
                      v-if="bindSent"
                      class="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400"
                    >
                      <CheckCircle2Icon class="size-3" />
                      验证码已发送至新邮箱，请及时填写
                    </p>
                  </div>

                  <div class="flex items-center justify-between gap-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      class="h-8 cursor-pointer gap-1.5 text-xs text-muted-foreground"
                      @click="resetEmailChangeFlow()"
                    >
                      <RotateCcwIcon class="size-3.5" />
                      重新开始
                    </Button>
                    <Button
                      size="sm"
                      class="h-8 cursor-pointer gap-1.5 text-xs"
                      :disabled="!canBindEmail"
                      @click="handleBindEmail"
                    >
                      <Spinner v-if="bindingEmail" />
                      <ShieldCheckIcon v-else class="size-3.5" />
                      {{ bindingEmail ? '绑定中…' : '校验并绑定' }}
                    </Button>
                  </div>
                </div>

                <!-- 步骤 4：完成 -->
                <div
                  v-else
                  class="flex flex-col items-center gap-3 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-4 py-7 text-center"
                >
                  <div
                    class="flex size-10 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  >
                    <CheckCircle2Icon class="size-5" />
                  </div>
                  <div class="flex flex-col gap-1">
                    <p class="text-sm font-semibold text-foreground">新邮箱已绑定</p>
                    <p class="truncate font-mono text-xs text-muted-foreground">{{ boundEmail }}</p>
                  </div>
                  <p class="text-[11px] text-muted-foreground">
                    现在可以使用该邮箱登录或找回密码。
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    class="mt-1 h-8 cursor-pointer text-xs"
                    @click="resetEmailChangeFlow()"
                  >
                    完成
                  </Button>
                </div>

                <Separator v-if="emailStep !== 4" />

                <Alert v-if="emailStep !== 4" class="py-2.5">
                  <ShieldCheckIcon />
                  <AlertDescription class="text-xs">
                    换绑期间请保持当前登录状态；每一步都会实时校验凭证，过期后可重新验证密码继续。
                  </AlertDescription>
                </Alert>
              </CardContent>
            </TabsContent>
          </Tabs>
        </Card>
      </div>
    </div>
  </BasicPage>
</template>
