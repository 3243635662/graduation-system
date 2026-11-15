<script setup lang="ts">
import { Badge } from '@/components/ui/badge'
import type { StatusTone } from '@/constants/rbac-labels'
import { cn } from '@/lib/utils'

/**
 * 状态徽章
 *
 * 语义色调集中在一个地方维护，避免各页面自行硬编码颜色。
 * 使用低饱和底色 + 同色文字，符合管理后台的克制表达。
 */
withDefaults(defineProps<{ label: string; tone?: StatusTone; class?: string }>(), {
  tone: 'neutral',
  class: '',
})

const toneClass: Record<StatusTone, string> = {
  success: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-400',
  info: 'bg-sky-500/12 text-sky-700 dark:text-sky-400',
  warning: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  danger: 'bg-destructive/12 text-destructive',
  neutral: 'bg-muted text-muted-foreground',
}
</script>

<template>
  <Badge
    variant="outline"
    :class="cn('border-transparent font-medium', toneClass[tone], $props.class)"
  >
    {{ label }}
  </Badge>
</template>
