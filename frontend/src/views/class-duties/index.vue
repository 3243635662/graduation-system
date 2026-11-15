<script setup lang="ts">
/**
 * 班主任任职 /class-duties
 *
 * 当前版本只做只读列表（GET /teacher-class-duties）；
 * 任职创建与撤销接口已存在，但需要先完善教师检索与时间区间交互，留待下一步接入。
 */
import { DataTable, type DataTableColumn } from '@/components/data-table'
import { BasicPage } from '@/components/global-layout'
import StatusBadge from '@/components/status-badge.vue'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useListQuery } from '@/composables/use-list-query'
import { ASSIGNMENT_RECORD_STATUS_OPTIONS, ORGANIZATION_TYPE_LABEL } from '@/constants/rbac-labels'
import { formatDate, orPlaceholder } from '@/lib/format'
import { listTeacherClassDuties } from '@/services/api/class-affairs.api'
import type { TeacherClassDutyItem } from '@/services/types/class-affairs.type'
import type { AssignmentRecordStatus } from '@/services/types/rbac.type'
import { RefreshCwIcon } from '@lucide/vue'
import { ref } from 'vue'

const statusFilter = ref('EFFECTIVE')

const { rows, total, page, pageSize, loading, error, reload, search, changePage, changePageSize } =
  useListQuery<TeacherClassDutyItem, { status?: AssignmentRecordStatus }>({
    fetcher: (params) => listTeacherClassDuties(params),
    filters: () => ({ status: statusFilter.value as AssignmentRecordStatus }),
  })

const columns: DataTableColumn[] = [
  { key: 'teacherName', title: '教师', width: '140px' },
  { key: 'teacherNo', title: '教师编号', width: '120px' },
  { key: 'className', title: '班级', width: '160px' },
  { key: 'classCode', title: '班级编码', width: '120px', hideOnMobile: true },
  { key: 'dutyType', title: '任职类型', width: '110px', hideOnMobile: true },
  { key: 'validFrom', title: '生效时间', width: '120px' },
  { key: 'validUntil', title: '失效时间', width: '120px', hideOnMobile: true },
  { key: 'isEffective', title: '状态', width: '100px' },
]

function handleStatusChange(value: unknown): void {
  statusFilter.value = String(value ?? 'EFFECTIVE')
  void search()
}
</script>

<template>
  <BasicPage
    title="班主任任职"
    description="查看班级班主任任职与历史；任职与撤销操作需在教师档案完善后接入。"
  >
    <template #actions>
      <Button variant="outline" :disabled="loading" @click="reload">
        <RefreshCwIcon />
        刷新
      </Button>
    </template>

    <div class="space-y-4">
      <div class="flex flex-wrap items-center gap-2">
        <Select :model-value="statusFilter" @update:model-value="handleStatusChange">
          <SelectTrigger class="w-[150px]" aria-label="记录状态">
            <SelectValue placeholder="当前有效" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              v-for="item in ASSIGNMENT_RECORD_STATUS_OPTIONS"
              :key="item.value"
              :value="item.value"
            >
              {{ item.label }}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DataTable
        :columns="columns"
        :rows="rows"
        :loading="loading"
        :error="error"
        :total="total"
        :page="page"
        :page-size="pageSize"
        empty-title="没有匹配的班主任任职"
        empty-description="调整状态筛选后重试。"
        @update:page="changePage"
        @update:page-size="changePageSize"
      >
        <template #cell-teacherName="{ row }">
          <div class="flex flex-col">
            <span class="font-medium">{{ row.teacherName }}</span>
            <span class="text-[11px] text-muted-foreground">{{ row.teacherEmail }}</span>
          </div>
        </template>

        <template #cell-teacherNo="{ row }">
          <span class="font-mono text-xs">{{ row.teacherNo }}</span>
        </template>

        <template #cell-className="{ row }">
          <div class="flex flex-col">
            <span>{{ row.className }}</span>
            <span class="text-[11px] text-muted-foreground">
              {{ ORGANIZATION_TYPE_LABEL.CLASS }} · {{ orPlaceholder(row.classCode) }}
            </span>
          </div>
        </template>

        <template #cell-dutyType="{ row }">
          <span class="text-muted-foreground">{{ row.dutyType }}</span>
        </template>

        <template #cell-validFrom="{ row }">
          <span class="text-xs">{{ formatDate(row.validFrom) }}</span>
        </template>

        <template #cell-validUntil="{ row }">
          <span class="text-xs">{{ row.validUntil ? formatDate(row.validUntil) : '长期' }}</span>
        </template>

        <template #cell-isEffective="{ row }">
          <StatusBadge
            :label="row.revokedAt ? '已撤销' : row.isEffective ? '生效中' : '未生效'"
            :tone="row.revokedAt ? 'neutral' : row.isEffective ? 'success' : 'warning'"
          />
        </template>
      </DataTable>
    </div>
  </BasicPage>
</template>
