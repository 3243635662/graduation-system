<script setup lang="ts">
/**
 * 辅导员分配 /counselors
 *
 * 当前版本只做只读列表（GET /counselor-class-assignments），
 * 分配与撤销接口已存在，待接入班级检索后补齐写操作。
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
import {
  ASSIGNMENT_RECORD_STATUS_OPTIONS,
  USER_STATUS_LABEL,
  USER_STATUS_TONE,
} from '@/constants/rbac-labels'
import { formatDate, orPlaceholder } from '@/lib/format'
import { listCounselorAssignments } from '@/services/api/class-affairs.api'
import type { CounselorAssignmentItem } from '@/services/types/class-affairs.type'
import type { AssignmentRecordStatus } from '@/services/types/rbac.type'
import { RefreshCwIcon } from '@lucide/vue'
import { ref } from 'vue'

const statusFilter = ref('EFFECTIVE')

const { rows, total, page, pageSize, loading, error, reload, search, changePage, changePageSize } =
  useListQuery<CounselorAssignmentItem, { status?: AssignmentRecordStatus }>({
    fetcher: (params) => listCounselorAssignments(params),
    filters: () => ({ status: statusFilter.value as AssignmentRecordStatus }),
  })

const columns: DataTableColumn[] = [
  { key: 'userName', title: '辅导员', width: '150px' },
  { key: 'userStatus', title: '账号状态', width: '100px' },
  { key: 'className', title: '班级', width: '160px' },
  { key: 'classCode', title: '班级编码', width: '120px', hideOnMobile: true },
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
    title="辅导员分配"
    description="查看辅导员与班级的分配关系及历史，分配操作将在后续版本接入。"
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
        empty-title="没有匹配的辅导员分配"
        empty-description="调整状态筛选后重试。"
        @update:page="changePage"
        @update:page-size="changePageSize"
      >
        <template #cell-userName="{ row }">
          <div class="flex flex-col">
            <span class="font-medium">{{ row.userName }}</span>
            <span class="text-[11px] text-muted-foreground">{{ row.userEmail }}</span>
          </div>
        </template>

        <template #cell-userStatus="{ row }">
          <StatusBadge
            :label="USER_STATUS_LABEL[row.userStatus]"
            :tone="USER_STATUS_TONE[row.userStatus]"
          />
        </template>

        <template #cell-className="{ row }">
          <div class="flex flex-col">
            <span>{{ row.className }}</span>
            <span class="text-[11px] text-muted-foreground">{{
              orPlaceholder(row.classCode)
            }}</span>
          </div>
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
