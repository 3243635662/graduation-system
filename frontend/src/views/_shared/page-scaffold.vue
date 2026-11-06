<script setup lang="ts">
import { BasicPage } from '@/components/global-layout'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * V1 页面骨架
 * 仅负责呈现页面定位、规划能力与访问角色，不包含任何业务逻辑。
 * 后续迭代时，用真实业务组件替换下方的「业务内容区域」即可。
 */
defineProps<{
  /** 页面标题，与菜单标题保持一致 */
  title: string
  /** 页面定位说明 */
  description: string
  /** 本页规划中的核心功能点 */
  features: string[]
  /** 允许访问的角色（仅用于说明，最终以 RoleMenu 配置为准） */
  roles?: string[]
}>()
</script>

<template>
  <BasicPage :title="title" :description="description">
    <div class="space-y-4">
      <Card class="border-dashed">
        <CardHeader>
          <CardTitle class="flex flex-wrap items-center gap-2 text-base">
            {{ title }}
            <Badge variant="secondary">V1 页面骨架</Badge>
          </CardTitle>
          <CardDescription>{{ description }}</CardDescription>
        </CardHeader>

        <CardContent class="space-y-4">
          <div v-if="roles?.length" class="flex flex-wrap items-center gap-2">
            <span class="text-sm text-muted-foreground">访问角色：</span>
            <Badge v-for="role in roles" :key="role" variant="outline">{{ role }}</Badge>
          </div>

          <div class="space-y-2">
            <p class="text-sm font-medium">规划功能</p>
            <ul class="grid gap-2 sm:grid-cols-2">
              <li
                v-for="feature in features"
                :key="feature"
                class="flex items-start gap-2 text-sm text-muted-foreground"
              >
                <span class="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground/60" />
                <span>{{ feature }}</span>
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>

      <div
        class="flex min-h-64 flex-col items-center justify-center gap-1 rounded-lg border border-dashed bg-muted/30 p-10 text-center"
      >
        <p class="text-sm font-medium">业务内容区域</p>
        <p class="text-xs text-muted-foreground">
          此处将承载 {{ title }} 的列表、表单与统计视图，当前版本仅占位。
        </p>
      </div>
    </div>
  </BasicPage>
</template>
