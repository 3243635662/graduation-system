import type { PaginatedData, PaginationQuery } from '@graduation/shared'
import { onMounted, ref, shallowRef, watch } from 'vue'

export interface UseListQueryOptions<TItem, TFilters extends object> {
  /** 列表接口封装：入参为分页 + 筛选条件，返回 { total, list } */
  fetcher: (params: TFilters & PaginationQuery) => Promise<PaginatedData<TItem>>
  /** 读取当前筛选条件；必须返回最新值（通常在调用方用 ref 组装） */
  filters: () => TFilters
  pageSize?: number
  /** 是否在组件挂载时自动加载，默认 true */
  immediate?: boolean
}

/**
 * 分页列表状态管理
 *
 * 负责 page / pageSize / loading / error 与竞态处理，
 * 页面只需要关心「筛选条件 + 渲染」，避免每个页面重复写同一套逻辑。
 *
 * 竞态处理：每次请求带自增序号，只有最后一次请求的结果会写回状态，
 * 快速切换页码时不会被旧响应覆盖。
 */
export function useListQuery<TItem, TFilters extends object>(
  options: UseListQueryOptions<TItem, TFilters>,
) {
  const page = ref(1)
  const pageSize = ref(options.pageSize ?? 10)
  const rows = shallowRef<TItem[]>([])
  const total = ref(0)
  const loading = ref(false)
  const error = ref('')

  let requestSeq = 0

  async function reload(): Promise<void> {
    const seq = ++requestSeq

    loading.value = true
    error.value = ''

    try {
      const result = await options.fetcher({
        ...options.filters(),
        page: page.value,
        pageSize: pageSize.value,
      })

      if (seq !== requestSeq) return

      rows.value = result.list
      total.value = result.total

      // 删除最后一页的最后一条后，回退到上一页
      if (result.list.length === 0 && result.total > 0 && page.value > 1) {
        page.value = Math.max(1, Math.ceil(result.total / pageSize.value))

        return
      }
    } catch (rawError) {
      if (seq !== requestSeq) return

      rows.value = []
      total.value = 0
      error.value = rawError instanceof Error ? rawError.message : '加载失败，请稍后重试'
    } finally {
      if (seq === requestSeq) loading.value = false
    }
  }

  /** 条件变化后从第一页重新查询 */
  async function search(): Promise<void> {
    if (page.value !== 1) {
      page.value = 1

      return
    }

    await reload()
  }

  function changePage(next: number): void {
    const maxPage = Math.max(1, Math.ceil(total.value / pageSize.value))
    const target = Math.min(Math.max(1, next), maxPage)

    if (target === page.value) return

    page.value = target
  }

  function changePageSize(next: number): void {
    if (next === pageSize.value) return

    pageSize.value = next
    page.value = 1
  }

  watch([page, pageSize], () => {
    void reload()
  })

  if (options.immediate !== false) {
    onMounted(() => {
      void reload()
    })
  }

  return {
    page,
    pageSize,
    rows,
    total,
    loading,
    error,
    reload,
    search,
    changePage,
    changePageSize,
  }
}
