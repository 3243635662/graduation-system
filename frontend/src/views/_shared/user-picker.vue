<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { listUsers } from '@/services/api/users.api'
import type { UserAccountItem } from '@/services/types/rbac.type'
import { SearchIcon, UserRoundPlusIcon } from '@lucide/vue'
import { onMounted, ref } from 'vue'

/**
 * 用户账号选择器
 *
 * 学生档案、工作人员档案都必须绑定一个「已存在的账号」，
 * 因此这里只负责按关键字搜索并回传选中的用户，不做任何创建动作。
 */
const props = withDefaults(
  defineProps<{
    modelValue: UserAccountItem | null
    /** 已绑定档案的用户不允许再次选择（可选） */
    disabled?: boolean
    placeholder?: string
  }>(),
  {
    disabled: false,
    placeholder: '搜索姓名或邮箱，选择要绑定档案的账号',
  },
)

const emit = defineEmits<{
  'update:modelValue': [user: UserAccountItem | null]
}>()

const keyword = ref('')
const loading = ref(false)
const error = ref('')
const options = ref<UserAccountItem[]>([])

async function search(): Promise<void> {
  loading.value = true
  error.value = ''

  try {
    const result = await listUsers({
      page: 1,
      pageSize: 10,
      keyword: keyword.value.trim() || undefined,
      status: 'ACTIVE',
    })

    options.value = result.list
  } catch (rawError) {
    options.value = []
    error.value = rawError instanceof Error ? rawError.message : '搜索账号失败'
  } finally {
    loading.value = false
  }
}

function select(user: UserAccountItem): void {
  emit('update:modelValue', user)
}

function clear(): void {
  emit('update:modelValue', null)
  keyword.value = ''
  void search()
}

onMounted(() => {
  if (!props.modelValue) void search()
})
</script>

<template>
  <div class="space-y-2">
    <!-- 已选中：展示摘要，允许更换 -->
    <div
      v-if="modelValue"
      class="flex items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2"
    >
      <div class="min-w-0">
        <p class="truncate text-sm font-medium">{{ modelValue.realName }}</p>
        <p class="truncate text-xs text-muted-foreground">{{ modelValue.email }}</p>
      </div>
      <Button type="button" variant="ghost" size="sm" :disabled="disabled" @click="clear">
        更换
      </Button>
    </div>

    <!-- 未选中：搜索 + 结果列表 -->
    <template v-else>
      <div class="flex gap-2">
        <div class="relative flex-1">
          <SearchIcon
            class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            :model-value="keyword"
            class="pl-9"
            :placeholder="placeholder"
            :disabled="disabled"
            @update:model-value="keyword = String($event)"
            @keyup.enter="search"
          />
        </div>
        <Button type="button" variant="outline" :disabled="loading || disabled" @click="search">
          搜索
        </Button>
      </div>

      <div v-if="error" class="text-xs text-destructive">{{ error }}</div>

      <div v-else-if="loading" class="space-y-1.5">
        <Skeleton v-for="index in 3" :key="index" class="h-11 w-full" />
      </div>

      <ul v-else-if="options.length" class="max-h-52 space-y-1 overflow-y-auto">
        <li v-for="user in options" :key="user.id">
          <button
            type="button"
            class="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left transition-colors hover:bg-accent"
            :disabled="disabled"
            @click="select(user)"
          >
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium">{{ user.realName }}</p>
              <p class="truncate text-xs text-muted-foreground">{{ user.email }}</p>
            </div>
            <span
              v-if="user.studentProfile || user.teacherProfile"
              class="text-[11px] text-muted-foreground"
            >
              已有档案
            </span>
          </button>
        </li>
      </ul>

      <p v-else class="flex items-center gap-1.5 text-xs text-muted-foreground">
        <UserRoundPlusIcon class="size-3.5" />
        没有匹配的账号，请检查关键字或先由管理员创建账号。
      </p>
    </template>
  </div>
</template>
