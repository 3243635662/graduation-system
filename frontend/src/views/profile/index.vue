<script setup lang="ts">
/**
 * 个人资料 /profile
 *
 * 只能修改真实姓名、手机号与头像地址（PATCH /users/me/profile）。
 * 学号、工号、班级与组织归属不允许通过本人修改，因此这里不展示可编辑入口。
 */
import { BasicPage } from '@/components/global-layout'
import StatusBadge from '@/components/status-badge.vue'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { useSubmitAction } from '@/composables/use-submit-action'
import { USER_STATUS_LABEL, USER_STATUS_TONE } from '@/constants/rbac-labels'
import { useAuthStore } from '@/stores/auth'
import { profileSchema } from '@/validators/auth.schema'
import { firstIssueMessage } from '@/validators/rbac.schema'
import type { UpdateMyProfileInput } from '@graduation/shared'
import { ref, watch } from 'vue'
import { toast } from 'vue-sonner'

const authStore = useAuthStore()
const { submitting, submit } = useSubmitAction()

const realName = ref(authStore.user?.realName ?? '')
const phone = ref(authStore.user?.phone ?? '')
const avatarUrl = ref(authStore.user?.avatarUrl ?? '')

/** 用户信息变化时同步表单（例如资料保存成功后 Store 已更新） */
watch(
  () => authStore.user,
  (user) => {
    realName.value = user?.realName ?? ''
    phone.value = user?.phone ?? ''
    avatarUrl.value = user?.avatarUrl ?? ''
  },
)

const avatarFallback = (): string => {
  const name = (authStore.user?.realName ?? '').trim()

  if (!name) return 'U'
  if (/^[\u4e00-\u9fa5]+$/.test(name)) return name.slice(-2)

  return name.slice(0, 1).toUpperCase()
}

/** 还原为 Store 中的当前值 */
function handleReset(): void {
  realName.value = authStore.user?.realName ?? ''
  phone.value = authStore.user?.phone ?? ''
  avatarUrl.value = authStore.user?.avatarUrl ?? ''
}

async function handleSubmit(): Promise<void> {
  const parsed = profileSchema.safeParse({
    realName: realName.value,
    phone: phone.value,
    avatarUrl: avatarUrl.value,
  })

  if (!parsed.success) {
    toast.error(firstIssueMessage(parsed.error))

    return
  }

  const payload: UpdateMyProfileInput = {
    // 姓名留空表示不修改（后端也不接受空姓名）
    ...(parsed.data.realName ? { realName: parsed.data.realName } : {}),
    // 手机号与头像留空表示清空，因此显式传 null
    phone: parsed.data.phone ? parsed.data.phone : null,
    avatarUrl: parsed.data.avatarUrl ? parsed.data.avatarUrl : null,
  }

  await submit(() => authStore.updateProfile(payload), {
    success: '个人资料已更新',
  })
}
</script>

<template>
  <BasicPage title="个人资料" description="维护本人在系统中的真实姓名、联系方式与头像。">
    <template #actions>
      <Button :disabled="submitting" @click="handleSubmit">保存修改</Button>
    </template>

    <div class="grid gap-4 lg:grid-cols-3">
      <!-- 概览 -->
      <Card class="lg:col-span-1">
        <CardHeader>
          <CardTitle class="text-base">账号概览</CardTitle>
          <CardDescription>姓名与头像会显示在侧边栏与操作记录中。</CardDescription>
        </CardHeader>
        <CardContent class="space-y-4">
          <div class="flex items-center gap-3">
            <Avatar class="size-14 rounded-xl">
              <AvatarImage :src="avatarUrl" :alt="realName" />
              <AvatarFallback class="rounded-xl text-base">{{ avatarFallback() }}</AvatarFallback>
            </Avatar>
            <div class="min-w-0">
              <p class="truncate text-base font-semibold">{{ realName || '未设置姓名' }}</p>
              <p class="truncate text-xs text-muted-foreground">
                {{ authStore.user?.email ?? '—' }}
              </p>
            </div>
          </div>

          <Separator />

          <dl class="space-y-2 text-sm">
            <div class="flex items-center justify-between gap-2">
              <dt class="text-muted-foreground">账号状态</dt>
              <dd>
                <StatusBadge
                  v-if="authStore.user"
                  :label="USER_STATUS_LABEL[authStore.user.status]"
                  :tone="USER_STATUS_TONE[authStore.user.status]"
                />
                <span v-else>—</span>
              </dd>
            </div>
            <div class="flex items-center justify-between gap-2">
              <dt class="text-muted-foreground">手机号</dt>
              <dd>{{ phone || '—' }}</dd>
            </div>
          </dl>

          <Separator />

          <div class="space-y-2">
            <p class="text-sm font-medium">角色</p>
            <div v-if="authStore.user?.roles.length" class="flex flex-wrap gap-1.5">
              <Badge
                v-for="role in authStore.user.roles"
                :key="role.id"
                variant="secondary"
                class="font-normal"
              >
                {{ role.scopeOrgUnitName ? `${role.name} · ${role.scopeOrgUnitName}` : role.name }}
              </Badge>
            </div>
            <p v-else class="text-xs text-muted-foreground">当前没有角色授权。</p>
          </div>

          <p class="text-[11px] text-muted-foreground">
            学号、工号、班级与组织归属由管理员维护，如需调整请联系管理员。
          </p>
        </CardContent>
      </Card>

      <!-- 编辑 -->
      <Card class="lg:col-span-2">
        <CardHeader>
          <CardTitle class="text-base">可编辑信息</CardTitle>
          <CardDescription>留空手机号或头像地址即可清空对应字段。</CardDescription>
        </CardHeader>

        <CardContent class="space-y-4">
          <div class="space-y-1.5">
            <Label for="profile-real-name">真实姓名</Label>
            <Input
              id="profile-real-name"
              :model-value="realName"
              placeholder="与学籍/人事档案一致，2-50 个字符"
              @update:model-value="realName = String($event)"
            />
          </div>

          <div class="space-y-1.5">
            <Label for="profile-phone">手机号</Label>
            <Input
              id="profile-phone"
              :model-value="phone"
              placeholder="用于接收通知，留空表示不填写"
              @update:model-value="phone = String($event)"
            />
          </div>

          <div class="space-y-1.5">
            <Label for="profile-avatar">头像地址</Label>
            <Input
              id="profile-avatar"
              :model-value="avatarUrl"
              placeholder="https://…"
              @update:model-value="avatarUrl = String($event)"
            />
            <p class="text-[11px] text-muted-foreground">
              仅支持 http(s) 链接；留空时使用姓名首字作为占位头像。
            </p>
          </div>

          <Separator />

          <div class="flex items-center gap-2">
            <Button :disabled="submitting" @click="handleSubmit">保存修改</Button>
            <Button variant="ghost" :disabled="submitting" @click="handleReset"> 重置 </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  </BasicPage>
</template>
