<script setup lang="ts">
import { BasicPage } from '@/components/global-layout'
import { Button } from '@/components/ui/button'
import { listMyClasses } from '@/services/api/class-affairs.api'
import type { MyClassItem } from '@/services/types/class-affairs.type'
import { RefreshCwIcon } from '@lucide/vue'
import { onMounted, ref } from 'vue'

const rows = ref<MyClassItem[]>([])
const loading = ref(false)
const error = ref('')

async function reload() {
  loading.value = true
  error.value = ''
  try {
    rows.value = await listMyClasses()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '加载班级职责失败'
  } finally {
    loading.value = false
  }
}

function responsibilityLabel(type: MyClassItem['responsibilities'][number]['type']) {
  return type === 'COUNSELOR' ? '辅导员负责' : '班级协管授权'
}

onMounted(() => void reload())
</script>

<template>
  <BasicPage title="我的班级" description="仅显示当前有效的辅导员分配与班级协管授权范围。">
    <template #actions>
      <Button variant="outline" :disabled="loading" @click="reload"><RefreshCwIcon />刷新</Button>
    </template>
    <div v-if="error" class="rounded-md border border-destructive/30 p-4 text-sm text-destructive">
      {{ error }}
    </div>
    <div v-else-if="loading" class="text-sm text-muted-foreground">正在加载班级职责…</div>
    <div v-else-if="rows.length === 0" class="rounded-md border p-6 text-sm text-muted-foreground">
      当前没有有效的班级职责。
    </div>
    <div v-else class="grid gap-4 md:grid-cols-2">
      <section v-for="item in rows" :key="item.classId" class="rounded-lg border p-4">
        <h2 class="font-semibold">{{ item.className }}</h2>
        <p class="mt-1 font-mono text-xs text-muted-foreground">{{ item.classCode }}</p>
        <ul class="mt-3 space-y-2 text-sm">
          <li v-for="responsibility in item.responsibilities" :key="responsibility.recordId">
            <span class="font-medium">{{ responsibilityLabel(responsibility.type) }}</span>
            <span v-if="responsibility.reason" class="text-muted-foreground"
              >：{{ responsibility.reason }}</span
            >
          </li>
        </ul>
      </section>
    </div>
  </BasicPage>
</template>
