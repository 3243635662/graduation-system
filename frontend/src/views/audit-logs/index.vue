<script setup lang="ts">
/**
 * 审计日志 /audit-logs
 *
 * 只读页面：后端不提供创建/修改/删除接口。
 * 查询条件只能在授权范围内收窄，before/after 是写入时经过安全校验的最小快照。
 */
import { DataTable, type DataTableColumn } from '@/components/data-table'
import { BasicPage } from '@/components/global-layout'
import StatusBadge from '@/components/status-badge.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useListQuery } from '@/composables/use-list-query'
import { formatDateTime, orPlaceholder } from '@/lib/format'
import { listAuditLogs } from '@/services/api/audit-logs.api'
import type { AuditLogItem, AuditResult, AuditSource } from '@graduation/shared'
import { RefreshCwIcon, SearchIcon } from '@lucide/vue'
import { computed, ref, shallowRef } from 'vue'

type AuditFilters = {
  action?: string
  targetType?: string
  result?: AuditResult
  source?: AuditSource
}

const actionKeyword = ref('')
const targetType = ref('')
const resultFilter = ref('ALL')
const sourceFilter = ref('ALL')

const filters = (): AuditFilters => ({
  action: actionKeyword.value.trim() || undefined,
  targetType: targetType.value.trim() || undefined,
  result: resultFilter.value === 'ALL' ? undefined : (resultFilter.value as AuditResult),
  source: sourceFilter.value === 'ALL' ? undefined : (sourceFilter.value as AuditSource),
})

const { rows, total, page, pageSize, loading, error, reload, search, changePage, changePageSize } =
  useListQuery<AuditLogItem, AuditFilters>({
    fetcher: (params) => listAuditLogs(params),
    filters,
  })

const columns: DataTableColumn[] = [
  { key: 'createdAt', title: '时间', width: '150px' },
  { key: 'actor', title: '操作人', width: '150px' },
  { key: 'action', title: '动作', width: '200px' },
  { key: 'target', title: '对象', width: '160px', hideOnMobile: true },
  { key: 'result', title: '结果', width: '90px' },
  { key: 'source', title: '来源', width: '90px', hideOnMobile: true },
  { key: 'reason', title: '原因', width: '160px', hideOnMobile: true },
  { key: 'actions', title: '快照', width: '70px', align: 'right' },
]

function reset(): void {
  actionKeyword.value = ''
  targetType.value = ''
  resultFilter.value = 'ALL'
  sourceFilter.value = 'ALL'
  void search()
}

// ——————————————————————————————————————————————
// 快照详情
// ——————————————————————————————————————————————

const detailOpen = ref(false)
// 审计快照的 JSON 类型是递归结构，深层 UnwrapRef 会触发 TS 深度上限，因此用 shallowRef
const detailItem = shallowRef<AuditLogItem | null>(null)

function openDetail(item: AuditLogItem): void {
  detailItem.value = item
  detailOpen.value = true
}

const beforeJson = computed(() =>
  detailItem.value?.before ? JSON.stringify(detailItem.value.before, null, 2) : '—',
)
const afterJson = computed(() =>
  detailItem.value?.after ? JSON.stringify(detailItem.value.after, null, 2) : '—',
)
</script>

<template>
  <BasicPage title="审计日志" description="按组织数据范围查看关键操作记录，日志只读且不可修改。">
    <template #actions>
      <Button variant="outline" :disabled="loading" @click="reload">
        <RefreshCwIcon />
        刷新
      </Button>
    </template>

    <div class="space-y-4">
      <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
        <div class="flex-1 space-y-1.5 sm:max-w-[220px]">
          <Label for="audit-action" class="text-xs text-muted-foreground">动作</Label>
          <Input
            id="audit-action"
            :model-value="actionKeyword"
            placeholder="如 student.profile.transfer"
            @update:model-value="actionKeyword = String($event)"
            @keyup.enter="search"
          />
        </div>

        <div class="flex-1 space-y-1.5 sm:max-w-[200px]">
          <Label for="audit-target" class="text-xs text-muted-foreground">对象类型</Label>
          <Input
            id="audit-target"
            :model-value="targetType"
            placeholder="如 STUDENT_PROFILE"
            @update:model-value="targetType = String($event)"
            @keyup.enter="search"
          />
        </div>

        <Select
          :model-value="resultFilter"
          @update:model-value="
            (value) => {
              resultFilter = String(value ?? 'ALL')
              void search()
            }
          "
        >
          <SelectTrigger class="w-full sm:w-[130px]" aria-label="执行结果">
            <SelectValue placeholder="全部结果" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">全部结果</SelectItem>
            <SelectItem value="SUCCESS">成功</SelectItem>
            <SelectItem value="FAILURE">失败</SelectItem>
          </SelectContent>
        </Select>

        <Select
          :model-value="sourceFilter"
          @update:model-value="
            (value) => {
              sourceFilter = String(value ?? 'ALL')
              void search()
            }
          "
        >
          <SelectTrigger class="w-full sm:w-[130px]" aria-label="来源">
            <SelectValue placeholder="全部来源" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">全部来源</SelectItem>
            <SelectItem value="WEB">WEB</SelectItem>
            <SelectItem value="IMPORT">IMPORT</SelectItem>
            <SelectItem value="SYSTEM">SYSTEM</SelectItem>
          </SelectContent>
        </Select>

        <div class="flex items-center gap-2">
          <Button @click="search">
            <SearchIcon />
            查询
          </Button>
          <Button variant="ghost" @click="reset">重置</Button>
        </div>
      </div>

      <DataTable
        :columns="columns"
        :rows="rows"
        :loading="loading"
        :error="error"
        :total="total"
        :page="page"
        :page-size="pageSize"
        empty-title="没有匹配的审计记录"
        empty-description="调整动作、对象类型或结果筛选后重试。"
        @update:page="changePage"
        @update:page-size="changePageSize"
      >
        <template #cell-createdAt="{ row }">
          <span class="text-xs text-muted-foreground">{{ formatDateTime(row.createdAt) }}</span>
        </template>

        <template #cell-actor="{ row }">
          <div class="flex flex-col">
            <span class="text-sm">{{ row.actorName ?? row.actorLabel ?? '系统' }}</span>
            <span class="text-[11px] text-muted-foreground">{{ row.actorType }}</span>
          </div>
        </template>

        <template #cell-action="{ row }">
          <span class="font-mono text-xs">{{ row.action }}</span>
        </template>

        <template #cell-target="{ row }">
          <div class="flex flex-col">
            <span class="text-xs">{{ row.targetType }}</span>
            <span class="truncate font-mono text-[11px] text-muted-foreground">
              {{ orPlaceholder(row.targetId) }}
            </span>
          </div>
        </template>

        <template #cell-result="{ row }">
          <StatusBadge
            :label="row.result === 'SUCCESS' ? '成功' : '失败'"
            :tone="row.result === 'SUCCESS' ? 'success' : 'danger'"
          />
        </template>

        <template #cell-source="{ row }">
          <Badge variant="outline" class="font-normal">{{ row.source }}</Badge>
        </template>

        <template #cell-reason="{ row }">
          <span class="text-xs text-muted-foreground">{{ orPlaceholder(row.reason) }}</span>
        </template>

        <template #cell-actions="{ row }">
          <Button variant="ghost" size="sm" @click="openDetail(row)">查看</Button>
        </template>
      </DataTable>
    </div>

    <Dialog v-model:open="detailOpen">
      <DialogContent class="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>审计快照</DialogTitle>
          <DialogDescription>
            {{ detailItem?.action }} · {{ formatDateTime(detailItem?.createdAt) }}
          </DialogDescription>
        </DialogHeader>

        <div class="space-y-4">
          <dl class="grid grid-cols-3 gap-y-2 text-sm">
            <dt class="text-muted-foreground">操作人</dt>
            <dd class="col-span-2">
              {{ detailItem?.actorName ?? detailItem?.actorLabel ?? '系统' }}（{{
                detailItem?.actorType
              }}）
            </dd>
            <dt class="text-muted-foreground">对象</dt>
            <dd class="col-span-2 font-mono text-xs">
              {{ detailItem?.targetType }} / {{ orPlaceholder(detailItem?.targetId) }}
            </dd>
            <dt class="text-muted-foreground">请求 ID</dt>
            <dd class="col-span-2 font-mono text-xs">{{ orPlaceholder(detailItem?.requestId) }}</dd>
            <dt class="text-muted-foreground">原因</dt>
            <dd class="col-span-2">{{ orPlaceholder(detailItem?.reason) }}</dd>
          </dl>

          <div class="grid gap-3 sm:grid-cols-2">
            <div class="space-y-1.5">
              <p class="text-xs font-medium text-muted-foreground">变更前</p>
              <pre
                class="max-h-52 overflow-auto rounded-md bg-muted p-3 text-[11px] leading-relaxed"
                >{{ beforeJson }}</pre>
            </div>
            <div class="space-y-1.5">
              <p class="text-xs font-medium text-muted-foreground">变更后</p>
              <pre
                class="max-h-52 overflow-auto rounded-md bg-muted p-3 text-[11px] leading-relaxed"
                >{{ afterJson }}</pre>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </BasicPage>
</template>
