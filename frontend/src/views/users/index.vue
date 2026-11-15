<script setup lang="ts">
/**
 * 账号管理 /users
 *
 * 后端当前只提供账号查询（GET /users、GET /users/:id），没有 PATCH /users/:id，
 * 因此本页只做「列表 + 详情」，不提供状态修改入口，避免调用不存在的接口。
 */
import { DataTable, type DataTableColumn } from '@/components/data-table'
import { BasicPage } from '@/components/global-layout'
import StatusBadge from '@/components/status-badge.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { useListQuery } from '@/composables/use-list-query'
import { USER_STATUS_LABEL, USER_STATUS_OPTIONS, USER_STATUS_TONE } from '@/constants/rbac-labels'
import { formatDateTime, orPlaceholder } from '@/lib/format'
import { getUser, listUsers } from '@/services/api/users.api'
import type { UserAccountItem, UserListQuery } from '@/services/types/rbac.type'
import { RefreshCwIcon, SearchIcon } from '@lucide/vue'
import { ref } from 'vue'

type UserFilters = Omit<UserListQuery, 'page' | 'pageSize'>

const keyword = ref('')
const statusFilter = ref<string>('ALL')

const filters = (): UserFilters => ({
  keyword: keyword.value.trim() || undefined,
  status: statusFilter.value === 'ALL' ? undefined : (statusFilter.value as UserFilters['status']),
})

const { rows, total, page, pageSize, loading, error, reload, search, changePage, changePageSize } =
  useListQuery<UserAccountItem, UserFilters>({
    fetcher: (params) => listUsers(params),
    filters,
  })

const columns: DataTableColumn[] = [
  { key: 'realName', title: '姓名', width: '140px' },
  { key: 'email', title: '邮箱', width: '200px' },
  { key: 'status', title: '账号状态', width: '100px' },
  { key: 'roles', title: '角色', width: '220px' },
  { key: 'profiles', title: '档案', width: '180px', hideOnMobile: true },
  { key: 'lastLoginAt', title: '最近登录', width: '150px', hideOnMobile: true },
  { key: 'actions', title: '操作', width: '80px', align: 'right' },
]

function handleStatusChange(value: unknown): void {
  statusFilter.value = String(value ?? 'ALL')
  void search()
}

function handleKeywordChange(value: string | number): void {
  keyword.value = String(value)
}

function handleSearch(): void {
  void search()
}

function handleReset(): void {
  keyword.value = ''
  statusFilter.value = 'ALL'
  void search()
}

// ——————————————————————————————————————————————
// 详情抽屉
// ——————————————————————————————————————————————

const detailOpen = ref(false)
const detailLoading = ref(false)
const detailError = ref('')
const detail = ref<UserAccountItem | null>(null)

async function openDetail(row: UserAccountItem): Promise<void> {
  detailOpen.value = true
  detailLoading.value = true
  detailError.value = ''
  detail.value = null

  try {
    detail.value = await getUser(row.id)
  } catch (rawError) {
    detailError.value = rawError instanceof Error ? rawError.message : '加载用户详情失败'
  } finally {
    detailLoading.value = false
  }
}

function handleRowClick(row: UserAccountItem): void {
  void openDetail(row)
}

/** 角色徽章：显示角色名 + 组织范围，超出两个折叠 */
function roleLabel(role: UserAccountItem['roles'][number]): string {
  return role.scopeOrgUnitName ? `${role.name} · ${role.scopeOrgUnitName}` : role.name
}
</script>

<template>
  <BasicPage title="账号管理" description="查看授权组织范围内的账号、角色与人员档案摘要。">
    <template #actions>
      <Button variant="outline" :disabled="loading" @click="reload">
        <RefreshCwIcon />
        刷新
      </Button>
    </template>

    <div class="space-y-4">
      <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div class="relative flex-1 sm:max-w-xs">
          <SearchIcon
            class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            :model-value="keyword"
            class="pl-9"
            placeholder="搜索姓名或邮箱"
            @update:model-value="handleKeywordChange"
            @keyup.enter="handleSearch"
          />
        </div>

        <Select :model-value="statusFilter" @update:model-value="handleStatusChange">
          <SelectTrigger class="w-full sm:w-[140px]" aria-label="账号状态">
            <SelectValue placeholder="全部状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">全部状态</SelectItem>
            <SelectItem v-for="item in USER_STATUS_OPTIONS" :key="item.value" :value="item.value">
              {{ item.label }}
            </SelectItem>
          </SelectContent>
        </Select>

        <div class="flex items-center gap-2">
          <Button @click="handleSearch">
            <SearchIcon />
            查询
          </Button>
          <Button variant="ghost" @click="handleReset">重置</Button>
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
        clickable
        empty-title="没有匹配的账号"
        empty-description="调整搜索条件或状态筛选后重试。"
        @update:page="changePage"
        @update:page-size="changePageSize"
        @row-click="handleRowClick"
      >
        <template #cell-realName="{ row }">
          <span class="font-medium">{{ row.realName }}</span>
        </template>

        <template #cell-email="{ row }">
          <span class="text-muted-foreground">{{ row.email }}</span>
        </template>

        <template #cell-status="{ row }">
          <StatusBadge
            :label="USER_STATUS_LABEL[row.status]"
            :tone="USER_STATUS_TONE[row.status]"
          />
        </template>

        <template #cell-roles="{ row }">
          <div v-if="row.roles.length" class="flex flex-wrap items-center gap-1">
            <Badge
              v-for="role in row.roles.slice(0, 2)"
              :key="role.id"
              variant="secondary"
              class="max-w-[170px] truncate font-normal"
              :title="roleLabel(role)"
            >
              {{ roleLabel(role) }}
            </Badge>
            <Badge v-if="row.roles.length > 2" variant="outline" class="font-normal">
              +{{ row.roles.length - 2 }}
            </Badge>
          </div>
          <span v-else class="text-muted-foreground">—</span>
        </template>

        <template #cell-profiles="{ row }">
          <div class="flex flex-wrap gap-1">
            <Badge v-if="row.studentProfile" variant="outline" class="font-normal">
              学生 · {{ row.studentProfile.studentNo }}
            </Badge>
            <Badge v-if="row.teacherProfile" variant="outline" class="font-normal">
              教师 · {{ row.teacherProfile.teacherNo }}
            </Badge>
            <span v-if="!row.studentProfile && !row.teacherProfile" class="text-muted-foreground">
              —
            </span>
          </div>
        </template>

        <template #cell-lastLoginAt="{ row }">
          <span class="text-xs text-muted-foreground">{{ formatDateTime(row.lastLoginAt) }}</span>
        </template>

        <template #cell-actions="{ row }">
          <Button variant="ghost" size="sm" @click.stop="openDetail(row)">详情</Button>
        </template>
      </DataTable>
    </div>

    <Sheet v-model:open="detailOpen">
      <SheetContent class="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>账号详情</SheetTitle>
          <SheetDescription>账号基础信息、角色授权与人员档案摘要。</SheetDescription>
        </SheetHeader>

        <div class="flex-1 space-y-5 overflow-y-auto px-4 pb-4">
          <div v-if="detailLoading" class="space-y-2">
            <Skeleton class="h-4 w-1/2" />
            <Skeleton class="h-4 w-2/3" />
            <Skeleton class="h-20 w-full" />
          </div>

          <p v-else-if="detailError" class="text-sm text-destructive">{{ detailError }}</p>

          <template v-else-if="detail">
            <section class="space-y-2">
              <h3 class="text-sm font-semibold">基础信息</h3>
              <dl class="grid grid-cols-3 gap-y-2 text-sm">
                <dt class="text-muted-foreground">姓名</dt>
                <dd class="col-span-2 font-medium">{{ detail.realName }}</dd>
                <dt class="text-muted-foreground">邮箱</dt>
                <dd class="col-span-2 break-all">{{ detail.email }}</dd>
                <dt class="text-muted-foreground">手机号</dt>
                <dd class="col-span-2">{{ orPlaceholder(detail.phone) }}</dd>
                <dt class="text-muted-foreground">账号状态</dt>
                <dd class="col-span-2">
                  <StatusBadge
                    :label="USER_STATUS_LABEL[detail.status]"
                    :tone="USER_STATUS_TONE[detail.status]"
                  />
                </dd>
                <dt class="text-muted-foreground">创建时间</dt>
                <dd class="col-span-2">{{ formatDateTime(detail.createdAt) }}</dd>
                <dt class="text-muted-foreground">最近登录</dt>
                <dd class="col-span-2">{{ formatDateTime(detail.lastLoginAt) }}</dd>
              </dl>
            </section>

            <Separator />

            <section class="space-y-2">
              <h3 class="text-sm font-semibold">角色授权</h3>
              <p v-if="detail.roles.length === 0" class="text-sm text-muted-foreground">
                当前范围内没有可见的角色授权。
              </p>
              <ul v-else class="space-y-2">
                <li
                  v-for="role in detail.roles"
                  :key="role.id"
                  class="rounded-md border p-2.5 text-sm"
                >
                  <div class="flex items-center justify-between gap-2">
                    <span class="font-medium">{{ role.name }}</span>
                    <StatusBadge
                      :label="role.isEffective ? '已生效' : '未生效'"
                      :tone="role.isEffective ? 'success' : 'neutral'"
                    />
                  </div>
                  <p class="mt-1 text-xs text-muted-foreground">
                    范围：{{ role.scopeOrgUnitName ?? '全局' }} · 生效至
                    {{ role.validUntil ? formatDateTime(role.validUntil) : '长期' }}
                  </p>
                </li>
              </ul>
            </section>

            <Separator />

            <section class="space-y-2">
              <h3 class="text-sm font-semibold">学生档案</h3>
              <div v-if="detail.studentProfile" class="rounded-md border p-2.5 text-sm">
                <p>学号：{{ detail.studentProfile.studentNo }}</p>
                <p class="text-muted-foreground">
                  班级：{{ detail.studentProfile.className ?? '未分班' }}
                </p>
              </div>
              <p v-else class="text-sm text-muted-foreground">无可见学生档案。</p>
            </section>

            <section class="space-y-2">
              <h3 class="text-sm font-semibold">教师档案</h3>
              <div v-if="detail.teacherProfile" class="rounded-md border p-2.5 text-sm">
                <p>教师编号：{{ detail.teacherProfile.teacherNo }}</p>
                <p class="text-muted-foreground">
                  所属组织：{{ detail.teacherProfile.organizationName }}
                </p>
              </div>
              <p v-else class="text-sm text-muted-foreground">无可见教师档案。</p>
            </section>
          </template>
        </div>
      </SheetContent>
    </Sheet>
  </BasicPage>
</template>
