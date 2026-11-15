<script setup lang="ts">
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ChevronLeftIcon, ChevronRightIcon } from '@lucide/vue'
import { computed } from 'vue'

/**
 * 表格分页控件
 *
 * 只负责展示与派发事件，页码合法性（clamp / 最后一页回退）由 useListQuery 处理。
 */
const props = withDefaults(
  defineProps<{
    page: number
    pageSize: number
    total: number
    pageSizeOptions?: number[]
  }>(),
  {
    pageSizeOptions: () => [10, 20, 50],
  },
)

const emit = defineEmits<{
  'update:page': [page: number]
  'update:pageSize': [pageSize: number]
}>()

const pageCount = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)))
const canPrev = computed(() => props.page > 1)
const canNext = computed(() => props.page < pageCount.value)

/** 页码窗口：首页、末页、当前页附近，其余用省略号折叠 */
const pageItems = computed<Array<number | 'ellipsis'>>(() => {
  const count = pageCount.value
  const current = props.page

  if (count <= 7) {
    return Array.from({ length: count }, (_, index) => index + 1)
  }

  const items: Array<number | 'ellipsis'> = [1]
  const start = Math.max(2, current - 1)
  const end = Math.min(count - 1, current + 1)

  if (start > 2) items.push('ellipsis')

  for (let index = start; index <= end; index += 1) {
    items.push(index)
  }

  if (end < count - 1) items.push('ellipsis')

  items.push(count)

  return items
})

const rangeText = computed(() => {
  if (props.total === 0) return '共 0 条'

  const from = (props.page - 1) * props.pageSize + 1
  const to = Math.min(props.page * props.pageSize, props.total)

  return `第 ${from}-${to} 条 / 共 ${props.total} 条`
})

function goTo(next: number): void {
  if (next < 1 || next > pageCount.value || next === props.page) return

  emit('update:page', next)
}

function handlePageSize(value: unknown): void {
  const next = Number(value)

  if (!Number.isFinite(next) || next === props.pageSize) return

  emit('update:pageSize', next)
}
</script>

<template>
  <div
    class="flex flex-col gap-3 border-t px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
  >
    <p class="text-xs text-muted-foreground">{{ rangeText }}</p>

    <div class="flex flex-wrap items-center gap-2">
      <div class="flex items-center gap-1.5">
        <span class="hidden text-xs text-muted-foreground sm:inline">每页</span>
        <Select :model-value="String(pageSize)" @update:model-value="handlePageSize">
          <SelectTrigger class="h-8 w-[72px] text-xs" aria-label="每页条数">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem v-for="size in pageSizeOptions" :key="size" :value="String(size)">
              {{ size }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div class="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon-sm"
          :disabled="!canPrev"
          aria-label="上一页"
          @click="goTo(page - 1)"
        >
          <ChevronLeftIcon />
        </Button>

        <template v-for="(item, index) in pageItems" :key="`${item}-${index}`">
          <span v-if="item === 'ellipsis'" class="px-1 text-xs text-muted-foreground">…</span>
          <Button
            v-else
            :variant="item === page ? 'default' : 'outline'"
            size="icon-sm"
            class="text-xs tabular-nums"
            :aria-current="item === page ? 'page' : undefined"
            @click="goTo(item)"
          >
            {{ item }}
          </Button>
        </template>

        <Button
          variant="outline"
          size="icon-sm"
          :disabled="!canNext"
          aria-label="下一页"
          @click="goTo(page + 1)"
        >
          <ChevronRightIcon />
        </Button>
      </div>
    </div>
  </div>
</template>
