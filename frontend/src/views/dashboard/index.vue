<script setup lang="ts">
/**
 * 工作台 /dashboard
 * 面向全部角色：展示与角色相关的统计、待办与进度概览。
 * 当前保留模板的仪表盘视图作为默认样式，后续接入真实统计数据。
 */
import { BasicPage } from '@/components/global-layout'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from 'vue-sonner'

import OverviewContent from './components/overview-content.vue'

const tabs = [
  { name: 'Overview', value: 'overview' },
  { name: 'Analytics', value: 'analytics', disabled: true },
  { name: 'Reports', value: 'reports', disabled: true },
  { name: 'Notifications', value: 'notifications', disabled: true },
]

const defaultTab = tabs[0].value
</script>

<template>
  <BasicPage title="工作台" description="按角色展示毕业设计相关的统计、待办与进度概览。" sticky>
    <template #actions>
      <Button
        @click="
          () =>
            toast('hello', {
              position: 'top-center',
            })
        "
      >
        {{ $t('download') }}
      </Button>
    </template>

    <Tabs :default-value="defaultTab" class="w-full">
      <TabsList>
        <TabsTrigger
          v-for="tab in tabs"
          :key="tab.value"
          :value="tab.value"
          :disabled="tab.disabled"
        >
          {{ tab.name }}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="overview" class="space-y-4">
        <OverviewContent />
      </TabsContent>
    </Tabs>
  </BasicPage>
</template>
