<script setup lang="ts">
/**
 * 协管员授权 /coordinator-assignments
 *
 * 展示「协管员资格特殊覆盖」记录（GET /coordinator-overrides）。
 * 正常情况下协管资格由班主任 / 辅导员任职自动推导，这里只列出被特殊授权的例外情况。
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
import { ASSIGNMENT_RECORD_STATUS_OPTIONS } from '@/constants/rbac-labels'
import { formatDate, formatDateTime, orPlaceholder } from '@/lib/format'
import { listCoordinatorOverrides } from '@/services/api/class-affairs.api'
import type { CoordinatorOverrideItem } from '@/services/types/class-affairs.type'
import type { AssignmentRecordStatus } from '@/services/types/rbac.type'
import { RefreshCwIcon } from '@lucide/vue'
import { ref } from 'vue'

const statusFilter = ref('EFFECTIVE')

const { rows, total, page, pageSize, loading, error, reload, search, changePage, changePageSize } =
  useListQuery<CoordinatorOverrideItem, { status?: AssignmentRecordStatus }>({
    fetcher: (params) => listCoordinatorOverrides(params),
    filters: () => ({ status: statusFilter.value as AssignmentRecordStatus }),
  })

const columns: DataTableColumn[] = [
  { key: 'userName', title: '被授权人', width: '150px' },
  { key: 'className', title: '班级', width: '160px' },
  { key: 'reason', title: '授权原因', width: '200px', hideOnMobile: true },
  { key: 'grantedByName', title: '授权人', width: '120px' },
  { key: 'validFrom', title: '生效时间', width: '120px', hideOnMobile: true },
  { key: 'validUntil', title: '失效时间', width: '120px', hideOnMobile: true },
  { key: 'isEffective', title: '状态', width: '100px' },
  { key: 'revoked', title: '撤销信息', width: '160px', hideOnMobile: true },
]

function handleStatusChange(value: unknown): void {
  statusFilter.value = String(value ?? 'EFFECTIVE')
  void search()
}
</script>

<template>
  <BasicPage
    title="协管员授权"
    description="协管资格通常由班主任或辅导员任职自动推导，这里列出被特殊覆盖授权的例外记录。"
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
        empty-title="没有匹配的授权记录"
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

        <template #cell-className="{ row }">
          <div class="flex flex-col">
            <span>{{ row.className }}</span>
            <span class="text-[11px] text-muted-foreground">{{
              orPlaceholder(row.classCode)
            }}</span>
          </div>
        </template>

        <template #cell-reason="{ row }">
          <span class="text-xs text-muted-foreground">{{ orPlaceholder(row.reason) }}</span>
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

        <template #cell-revoked="{ row }">
          <div v-if="row.revokedAt" class="flex flex-col text-[11px] text-muted-foreground">
            <span>{{ formatDateTime(row.revokedAt) }}</span>
            <span>撤销人：{{ orPlaceholder(row.revokedByName) }}</span>
          </div>
          <span v-else class="text-xs text-muted-foreground">—</span>
        </template>
      </DataTable>
    </div>
  </BasicPage>
</template>
