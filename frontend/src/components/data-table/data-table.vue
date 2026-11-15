<script setup lang="ts" generic="TRow extends object">
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { InboxIcon, TriangleAlertIcon } from '@lucide/vue'
import { computed } from 'vue'

import DataTablePagination from './data-table-pagination.vue'
import type { DataTableCellSlotProps, DataTableColumn } from './types'

/**
 * 通用数据表格
 *
 * 约定：
 * - 列由 `columns` 描述，单元格默认渲染原始值；
 * - 需要自定义渲染时使用作用域插槽 `#cell-<key>`，拿到 `{ row, index, value }`；
 * - 分页、加载、空态、错误态内建，页面只负责取数与筛选。
 *
 * 不引入 tanstack/table 的原因：当前列表都是服务端分页 + 固定列，
 * 不需要排序、列宽拖拽与虚拟滚动，保持依赖与心智负担都更轻。
 */
const props = withDefaults(
  defineProps<{
    columns: DataTableColumn[]
    rows: readonly TRow[]
    loading?: boolean
    /** 总条数，用于分页展示 */
    total?: number
    page?: number
    pageSize?: number
    /** 加载失败信息，非空时展示错误态 */
    error?: string
    emptyTitle?: string
    emptyDescription?: string
    /** 整行可点击（打开详情抽屉） */
    clickable?: boolean
    /** 是否展示分页，默认在有数据时展示 */
    showPagination?: boolean
    skeletonRows?: number
  }>(),
  {
    loading: false,
    total: 0,
    page: 1,
    pageSize: 10,
    error: '',
    emptyTitle: '暂无数据',
    emptyDescription: '',
    clickable: false,
    showPagination: true,
    skeletonRows: 5,
  },
)

const emit = defineEmits<{
  'update:page': [page: number]
  'update:pageSize': [pageSize: number]
  'row-click': [row: TRow]
}>()

defineSlots<Record<string, (props: DataTableCellSlotProps<TRow>) => unknown>>()

const paginationVisible = computed(() => props.showPagination && props.total > 0)

/**
 * 复制一份可变数组再交给 v-for
 *
 * props.rows 是 readonly TRow[]，直接遍历时 Vue 的类型推导会把泛型当成 Ref 解包，
 * 导致行类型与插槽签名不一致；复制成 TRow[] 可以规避该问题。
 */
const tableRows = computed<TRow[]>(() => [...props.rows])

function cellValue(row: TRow, key: string): unknown {
  return (row as Record<string, unknown>)[key]
}

function rowKeyOf(row: TRow, index: number): string | number {
  const id = (row as { id?: unknown }).id

  return typeof id === 'string' || typeof id === 'number' ? id : index
}

/** 默认单元格渲染：空值统一显示破折号，布尔值转中文 */
function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? '是' : '否'

  return String(value)
}

function alignClass(align: DataTableColumn['align']): string {
  if (align === 'center') return 'text-center'
  if (align === 'right') return 'text-right'

  return 'text-left'
}
</script>

<template>
  <div class="overflow-hidden rounded-lg border bg-card">
    <div class="w-full overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow class="hover:bg-transparent">
            <TableHead
              v-for="column in columns"
              :key="column.key"
              :style="column.width ? { width: column.width } : undefined"
              :class="
                cn(
                  'h-9 text-xs font-medium tracking-wide text-muted-foreground',
                  alignClass(column.align),
                  column.hideOnMobile && 'hidden md:table-cell',
                )
              "
            >
              {{ column.title }}
            </TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          <template v-if="loading">
            <TableRow
              v-for="index in skeletonRows"
              :key="`skeleton-${index}`"
              class="hover:bg-transparent"
            >
              <TableCell
                v-for="column in columns"
                :key="column.key"
                :class="cn('py-3', column.hideOnMobile && 'hidden md:table-cell')"
              >
                <Skeleton class="h-4 w-full max-w-[140px]" />
              </TableCell>
            </TableRow>
          </template>

          <TableRow v-else-if="error">
            <TableCell :colspan="columns.length" class="py-10">
              <div class="flex flex-col items-center justify-center gap-2 text-center">
                <TriangleAlertIcon class="size-8 text-destructive" />
                <p class="text-sm font-medium text-foreground">加载失败</p>
                <p class="max-w-md text-xs text-muted-foreground">{{ error }}</p>
              </div>
            </TableCell>
          </TableRow>

          <TableEmpty v-else-if="rows.length === 0" :colspan="columns.length">
            <Empty class="border-0 p-0 md:p-0">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <InboxIcon />
                </EmptyMedia>
                <EmptyTitle class="text-sm">{{ emptyTitle }}</EmptyTitle>
                <EmptyDescription v-if="emptyDescription" class="text-xs">
                  {{ emptyDescription }}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </TableEmpty>

          <template v-else>
            <TableRow
              v-for="(row, index) in tableRows"
              :key="rowKeyOf(row, index)"
              :class="clickable ? 'cursor-pointer transition-colors hover:bg-muted/50' : undefined"
              @click="clickable && emit('row-click', row)"
            >
              <TableCell
                v-for="column in columns"
                :key="column.key"
                :class="
                  cn(
                    'py-3 text-sm',
                    alignClass(column.align),
                    column.hideOnMobile && 'hidden md:table-cell',
                  )
                "
              >
                <slot
                  :name="`cell-${column.key}`"
                  :row="row"
                  :index="index"
                  :value="cellValue(row, column.key)"
                >
                  {{ formatValue(cellValue(row, column.key)) }}
                </slot>
              </TableCell>
            </TableRow>
          </template>
        </TableBody>
      </Table>
    </div>

    <DataTablePagination
      v-if="paginationVisible"
      :page="page"
      :page-size="pageSize"
      :total="total"
      @update:page="emit('update:page', $event)"
      @update:page-size="emit('update:pageSize', $event)"
    />
  </div>
</template>
