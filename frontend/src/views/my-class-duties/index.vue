<script setup lang="ts">
import { BasicPage } from '@/components/global-layout'
import { Button } from '@/components/ui/button'
import { listMyTeacherClassDuties } from '@/services/api/class-affairs.api'
import type { MyTeacherClassDutyItem } from '@/services/types/class-affairs.type'
import { RefreshCwIcon } from '@lucide/vue'
import { onMounted, ref } from 'vue'

// 教师职责的详细业务页面将在教师端任务中扩展；这里保留真实职责入口，
// 菜单服务仅在有效 TeacherClassDuty 存在时将其授予教师。
const loading = ref(false)
const error = ref('')
const rows = ref<MyTeacherClassDutyItem[]>([])

async function reload() {
  loading.value = true
  error.value = ''
  try {
    rows.value = await listMyTeacherClassDuties()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '加载失败'
  } finally {
    loading.value = false
  }
}

onMounted(() => void reload())
</script>

<template>
  <BasicPage title="我的班级职责" description="当前有效的班主任职责入口。">
    <template #actions>
      <Button variant="outline" :disabled="loading" @click="reload"><RefreshCwIcon />刷新</Button>
    </template>
    <p v-if="error" class="text-sm text-destructive">{{ error }}</p>
    <div v-else class="space-y-2">
      <p v-for="item in rows" :key="item.id" class="rounded-md border p-3 text-sm">
        <span class="font-medium">{{ item.class.name }}</span>
        <span class="ml-2 text-muted-foreground">{{ item.class.code }} · {{ item.dutyType }}</span>
      </p>
    </div>
  </BasicPage>
</template>
