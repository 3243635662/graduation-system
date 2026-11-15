<script setup lang="ts">
/**
 * 学生档案 /students
 *
 * 覆盖 Phase 1 的全部写操作：
 * - 新建档案（必须绑定已存在的账号，可暂不分班）
 * - 修改学号与入学年份
 * - 首次分班 / 转班（共用 /transfer，写分班历史）
 * - 修改学籍状态
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { Textarea } from '@/components/ui/textarea'
import { useListQuery } from '@/composables/use-list-query'
import { useOrganizationOptions } from '@/composables/use-organization-options'
import { useSubmitAction } from '@/composables/use-submit-action'
import {
  ENROLLMENT_STATUS_LABEL,
  ENROLLMENT_STATUS_OPTIONS,
  ENROLLMENT_STATUS_TONE,
  USER_STATUS_LABEL,
  USER_STATUS_TONE,
} from '@/constants/rbac-labels'
import { formatDateTime, orPlaceholder } from '@/lib/format'
import * as studentsApi from '@/services/api/students.api'
import type {
  EnrollmentStatus,
  StudentListQuery,
  StudentProfileDetail,
  StudentProfileItem,
} from '@/services/types/rbac.type'
import type { UserAccountItem } from '@/services/types/rbac.type'
import {
  firstIssueMessage,
  studentCreateSchema,
  studentEditSchema,
  studentTransferSchema,
  toOptionalText,
  toYearOrNull,
} from '@/validators/rbac.schema'
import { MoreHorizontalIcon, RefreshCwIcon, SearchIcon } from '@lucide/vue'
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'

import UserPicker from '../_shared/user-picker.vue'

type StudentFilters = Omit<StudentListQuery, 'page' | 'pageSize'>

// ——————————————————————————————————————————————
// 列表
// ——————————————————————————————————————————————

const keyword = ref('')
const statusFilter = ref('ALL')
/** 后端只提供 unassignedOnly，因此这里只能区分「全部」与「只看未分班」 */
const assignFilter = ref<'ALL' | 'UNASSIGNED'>('ALL')

const { classOptions } = useOrganizationOptions()
const { submitting, submit } = useSubmitAction()

const filters = (): StudentFilters => ({
  keyword: keyword.value.trim() || undefined,
  enrollmentStatus:
    statusFilter.value === 'ALL' ? undefined : (statusFilter.value as EnrollmentStatus),
  unassignedOnly: assignFilter.value === 'UNASSIGNED' ? true : undefined,
})

const { rows, total, page, pageSize, loading, error, reload, search, changePage, changePageSize } =
  useListQuery<StudentProfileItem, StudentFilters>({
    fetcher: (params) => studentsApi.listStudents(params),
    filters,
  })

const columns: DataTableColumn[] = [
  { key: 'studentNo', title: '学号', width: '130px' },
  { key: 'realName', title: '姓名', width: '110px' },
  { key: 'className', title: '班级', width: '150px' },
  { key: 'majorName', title: '专业', width: '160px', hideOnMobile: true },
  { key: 'enrollmentYear', title: '入学年份', width: '100px', hideOnMobile: true },
  { key: 'enrollmentStatus', title: '学籍状态', width: '110px' },
  { key: 'accountStatus', title: '账号状态', width: '100px', hideOnMobile: true },
  { key: 'actions', title: '操作', width: '70px', align: 'right' },
]

function handleStatusChange(value: unknown): void {
  statusFilter.value = String(value ?? 'ALL')
  void search()
}

function handleAssignChange(value: unknown): void {
  assignFilter.value = String(value ?? 'ALL') as typeof assignFilter.value
  void search()
}

function handleReset(): void {
  keyword.value = ''
  statusFilter.value = 'ALL'
  assignFilter.value = 'ALL'
  void search()
}

// ——————————————————————————————————————————————
// 详情
// ——————————————————————————————————————————————

const detailOpen = ref(false)
const detailLoading = ref(false)
const detailError = ref('')
const detail = ref<StudentProfileDetail | null>(null)

async function openDetail(row: StudentProfileItem): Promise<void> {
  detailOpen.value = true
  detailLoading.value = true
  detailError.value = ''
  detail.value = null

  try {
    detail.value = await studentsApi.getStudent(row.id)
  } catch (rawError) {
    detailError.value = rawError instanceof Error ? rawError.message : '加载学生详情失败'
  } finally {
    detailLoading.value = false
  }
}

// ——————————————————————————————————————————————
// 新建
// ——————————————————————————————————————————————

const createOpen = ref(false)
const selectedUser = ref<UserAccountItem | null>(null)
const createForm = ref({ studentNo: '', classId: '', enrollmentYear: '' })

function openCreate(): void {
  selectedUser.value = null
  createForm.value = { studentNo: '', classId: '', enrollmentYear: '' }
  createOpen.value = true
}

async function submitCreate(): Promise<void> {
  const parsed = studentCreateSchema.safeParse({
    userId: selectedUser.value?.id ?? '',
    ...createForm.value,
  })

  if (!parsed.success) {
    toast.error(firstIssueMessage(parsed.error))

    return
  }

  const ok = await submit(
    () =>
      studentsApi.createStudent({
        userId: parsed.data.userId,
        studentNo: parsed.data.studentNo,
        classId: toOptionalText(parsed.data.classId) ?? null,
        enrollmentYear: toYearOrNull(parsed.data.enrollmentYear),
      }),
    {
      success: '学生档案已创建',
      onSuccess: () => {
        createOpen.value = false
        void reload()
      },
    },
  )

  if (ok) createForm.value = { studentNo: '', classId: '', enrollmentYear: '' }
}

// ——————————————————————————————————————————————
// 编辑
// ——————————————————————————————————————————————

const editOpen = ref(false)
const editTarget = ref<StudentProfileItem | null>(null)
const editForm = ref({ studentNo: '', enrollmentYear: '' })

function openEdit(row: StudentProfileItem): void {
  editTarget.value = row
  editForm.value = {
    studentNo: row.studentNo,
    enrollmentYear: row.enrollmentYear ? String(row.enrollmentYear) : '',
  }
  editOpen.value = true
}

async function submitEdit(): Promise<void> {
  const target = editTarget.value

  if (!target) return

  const parsed = studentEditSchema.safeParse(editForm.value)

  if (!parsed.success) {
    toast.error(firstIssueMessage(parsed.error))

    return
  }

  await submit(
    () =>
      studentsApi.updateStudent(target.id, {
        studentNo: parsed.data.studentNo,
        enrollmentYear: toYearOrNull(parsed.data.enrollmentYear),
      }),
    {
      success: '学生档案已更新',
      onSuccess: () => {
        editOpen.value = false
        void reload()
      },
    },
  )
}

// ——————————————————————————————————————————————
// 分班 / 转班
// ——————————————————————————————————————————————

const transferOpen = ref(false)
const transferTarget = ref<StudentProfileItem | null>(null)
const transferForm = ref({ targetClassId: '', reason: '' })

/** 目标班级候选：排除当前班级 */
const transferClassOptions = computed(() =>
  classOptions.value.filter((item) => item.id !== transferTarget.value?.classId),
)

function openTransfer(row: StudentProfileItem): void {
  transferTarget.value = row
  transferForm.value = { targetClassId: '', reason: '' }
  transferOpen.value = true
}

async function submitTransfer(): Promise<void> {
  const target = transferTarget.value

  if (!target) return

  const parsed = studentTransferSchema.safeParse(transferForm.value)

  if (!parsed.success) {
    toast.error(firstIssueMessage(parsed.error))

    return
  }

  await submit(
    () =>
      studentsApi.transferStudent(target.id, {
        targetClassId: parsed.data.targetClassId,
        reason: parsed.data.reason,
      }),
    {
      success: target.classId ? '转班成功' : '分班成功',
      onSuccess: () => {
        transferOpen.value = false
        void reload()
      },
    },
  )
}

// ——————————————————————————————————————————————
// 学籍状态
// ——————————————————————————————————————————————

const statusOpen = ref(false)
const statusTarget = ref<StudentProfileItem | null>(null)
const nextStatus = ref<EnrollmentStatus>('ACTIVE')

function openStatus(row: StudentProfileItem): void {
  statusTarget.value = row
  nextStatus.value = row.enrollmentStatus
  statusOpen.value = true
}

function handleNextStatus(value: unknown): void {
  nextStatus.value = String(value) as EnrollmentStatus
}

async function submitStatus(): Promise<void> {
  const target = statusTarget.value

  if (!target) return

  await submit(() => studentsApi.updateStudentStatus(target.id, nextStatus.value), {
    success: '学籍状态已更新',
    onSuccess: () => {
      statusOpen.value = false
      void reload()
    },
  })
}
</script>

<template>
  <BasicPage
    title="学生档案"
    description="维护学生学号、班级归属与学籍状态，分班与转班均保留历史。"
  >
    <template #actions>
      <Button variant="outline" :disabled="loading" @click="reload">
        <RefreshCwIcon />
        刷新
      </Button>
      <Button @click="openCreate">新建学生档案</Button>
    </template>

    <div class="space-y-4">
      <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div class="relative flex-1 sm:max-w-xs">
          <SearchIcon
            class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            :model-value="keyword"
            class="pl-9"
            placeholder="搜索学号或姓名"
            @update:model-value="keyword = String($event)"
            @keyup.enter="search"
          />
        </div>

        <Select :model-value="statusFilter" @update:model-value="handleStatusChange">
          <SelectTrigger class="w-full sm:w-[140px]" aria-label="学籍状态">
            <SelectValue placeholder="全部学籍" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">全部学籍</SelectItem>
            <SelectItem
              v-for="item in ENROLLMENT_STATUS_OPTIONS"
              :key="item.value"
              :value="item.value"
            >
              {{ item.label }}
            </SelectItem>
          </SelectContent>
        </Select>

        <Select :model-value="assignFilter" @update:model-value="handleAssignChange">
          <SelectTrigger class="w-full sm:w-[150px]" aria-label="分班状态">
            <SelectValue placeholder="全部分班状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">全部分班状态</SelectItem>
            <SelectItem value="UNASSIGNED">只看未分班</SelectItem>
          </SelectContent>
        </Select>

        <div class="flex items-center gap-2">
          <Button @click="search">
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
        empty-title="没有匹配的学生档案"
        empty-description="调整筛选条件，或先为学生账号创建档案。"
        @update:page="changePage"
        @update:page-size="changePageSize"
      >
        <template #cell-studentNo="{ row }">
          <span class="font-mono text-xs">{{ row.studentNo }}</span>
        </template>

        <template #cell-realName="{ row }">
          <span class="font-medium">{{ row.realName }}</span>
        </template>

        <template #cell-className="{ row }">
          <Badge v-if="row.className" variant="secondary" class="font-normal">
            {{ row.className }}
          </Badge>
          <span v-else class="text-xs text-muted-foreground">未分班</span>
        </template>

        <template #cell-majorName="{ row }">
          <span class="text-muted-foreground">{{ orPlaceholder(row.majorName) }}</span>
        </template>

        <template #cell-enrollmentStatus="{ row }">
          <StatusBadge
            :label="ENROLLMENT_STATUS_LABEL[row.enrollmentStatus]"
            :tone="ENROLLMENT_STATUS_TONE[row.enrollmentStatus]"
          />
        </template>

        <template #cell-accountStatus="{ row }">
          <StatusBadge
            :label="USER_STATUS_LABEL[row.accountStatus]"
            :tone="USER_STATUS_TONE[row.accountStatus]"
          />
        </template>

        <template #cell-actions="{ row }">
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button variant="ghost" size="icon-sm" aria-label="更多操作">
                <MoreHorizontalIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="w-40">
              <DropdownMenuItem @click="openDetail(row)">查看详情</DropdownMenuItem>
              <DropdownMenuItem @click="openEdit(row)">编辑资料</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem @click="openTransfer(row)">
                {{ row.classId ? '转班' : '分班' }}
              </DropdownMenuItem>
              <DropdownMenuItem @click="openStatus(row)">修改学籍状态</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </template>
      </DataTable>
    </div>

    <!-- 新建 -->
    <Dialog v-model:open="createOpen">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>新建学生档案</DialogTitle>
          <DialogDescription>先选择学生账号，再填写学号；班级可以稍后再分配。</DialogDescription>
        </DialogHeader>

        <div class="space-y-4">
          <div class="space-y-1.5">
            <Label>绑定账号</Label>
            <UserPicker v-model="selectedUser" :disabled="submitting" />
          </div>

          <div class="space-y-1.5">
            <Label for="student-no">学号</Label>
            <Input
              id="student-no"
              :model-value="createForm.studentNo"
              placeholder="例如 2021001001"
              @update:model-value="createForm.studentNo = String($event)"
            />
          </div>

          <div class="grid gap-3 sm:grid-cols-2">
            <div class="space-y-1.5">
              <Label>班级（可选）</Label>
              <Select
                :model-value="createForm.classId"
                @update:model-value="createForm.classId = String($event ?? '')"
              >
                <SelectTrigger class="w-full">
                  <SelectValue placeholder="暂不分班" />
                </SelectTrigger>
                <SelectContent class="max-h-64">
                  <SelectItem v-for="option in classOptions" :key="option.id" :value="option.id">
                    {{ option.path }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div class="space-y-1.5">
              <Label for="enrollment-year">入学年份（可选）</Label>
              <Input
                id="enrollment-year"
                :model-value="createForm.enrollmentYear"
                placeholder="例如 2021"
                inputmode="numeric"
                @update:model-value="createForm.enrollmentYear = String($event)"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" :disabled="submitting" @click="createOpen = false">取消</Button>
          <Button :disabled="submitting" @click="submitCreate">创建</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- 编辑 -->
    <Dialog v-model:open="editOpen">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>编辑学生档案</DialogTitle>
          <DialogDescription>班级变更请使用「转班」，以保留完整历史。</DialogDescription>
        </DialogHeader>

        <div class="space-y-3">
          <div class="space-y-1.5">
            <Label for="edit-student-no">学号</Label>
            <Input
              id="edit-student-no"
              :model-value="editForm.studentNo"
              @update:model-value="editForm.studentNo = String($event)"
            />
          </div>
          <div class="space-y-1.5">
            <Label for="edit-enrollment-year">入学年份</Label>
            <Input
              id="edit-enrollment-year"
              :model-value="editForm.enrollmentYear"
              inputmode="numeric"
              placeholder="留空表示未填写"
              @update:model-value="editForm.enrollmentYear = String($event)"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" :disabled="submitting" @click="editOpen = false">取消</Button>
          <Button :disabled="submitting" @click="submitEdit">保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- 分班 / 转班 -->
    <Dialog v-model:open="transferOpen">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{{ transferTarget?.classId ? '学生转班' : '首次分班' }}</DialogTitle>
          <DialogDescription>
            当前班级：{{
              transferTarget?.className ?? '未分班'
            }}。操作会写入分班历史并重算协管资格。
          </DialogDescription>
        </DialogHeader>

        <div class="space-y-3">
          <div class="space-y-1.5">
            <Label>目标班级</Label>
            <Select
              :model-value="transferForm.targetClassId"
              @update:model-value="transferForm.targetClassId = String($event ?? '')"
            >
              <SelectTrigger class="w-full">
                <SelectValue placeholder="请选择目标班级" />
              </SelectTrigger>
              <SelectContent class="max-h-64">
                <SelectItem
                  v-for="option in transferClassOptions"
                  :key="option.id"
                  :value="option.id"
                >
                  {{ option.path }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div class="space-y-1.5">
            <Label for="transfer-reason">原因</Label>
            <Textarea
              id="transfer-reason"
              :model-value="transferForm.reason"
              rows="3"
              placeholder="填写分班或转班原因，将记录到历史中"
              @update:model-value="transferForm.reason = String($event)"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" :disabled="submitting" @click="transferOpen = false"
            >取消</Button
          >
          <Button :disabled="submitting" @click="submitTransfer">确认</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- 学籍状态 -->
    <Dialog v-model:open="statusOpen">
      <DialogContent class="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>修改学籍状态</DialogTitle>
          <DialogDescription>
            {{ statusTarget?.realName }}（{{ statusTarget?.studentNo }}）
          </DialogDescription>
        </DialogHeader>

        <Select :model-value="nextStatus" @update:model-value="handleNextStatus">
          <SelectTrigger class="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              v-for="item in ENROLLMENT_STATUS_OPTIONS"
              :key="item.value"
              :value="item.value"
            >
              {{ item.label }}
            </SelectItem>
          </SelectContent>
        </Select>

        <DialogFooter>
          <Button variant="outline" :disabled="submitting" @click="statusOpen = false">取消</Button>
          <Button :disabled="submitting" @click="submitStatus">保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- 详情 -->
    <Sheet v-model:open="detailOpen">
      <SheetContent class="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>学生档案详情</SheetTitle>
          <SheetDescription>基础信息、账号摘要与分班历史。</SheetDescription>
        </SheetHeader>

        <div class="flex-1 space-y-5 overflow-y-auto px-4 pb-4">
          <div v-if="detailLoading" class="space-y-2">
            <Skeleton class="h-4 w-1/2" />
            <Skeleton class="h-4 w-2/3" />
            <Skeleton class="h-24 w-full" />
          </div>

          <p v-else-if="detailError" class="text-sm text-destructive">{{ detailError }}</p>

          <template v-else-if="detail">
            <section class="space-y-2">
              <dl class="grid grid-cols-3 gap-y-2 text-sm">
                <dt class="text-muted-foreground">学号</dt>
                <dd class="col-span-2 font-mono text-xs">{{ detail.studentNo }}</dd>
                <dt class="text-muted-foreground">姓名</dt>
                <dd class="col-span-2 font-medium">{{ detail.realName }}</dd>
                <dt class="text-muted-foreground">班级</dt>
                <dd class="col-span-2">{{ detail.className ?? '未分班' }}</dd>
                <dt class="text-muted-foreground">专业</dt>
                <dd class="col-span-2">{{ orPlaceholder(detail.majorName) }}</dd>
                <dt class="text-muted-foreground">院系</dt>
                <dd class="col-span-2">{{ orPlaceholder(detail.departmentName) }}</dd>
                <dt class="text-muted-foreground">入学年份</dt>
                <dd class="col-span-2">{{ orPlaceholder(detail.enrollmentYear) }}</dd>
                <dt class="text-muted-foreground">学籍状态</dt>
                <dd class="col-span-2">
                  <StatusBadge
                    :label="ENROLLMENT_STATUS_LABEL[detail.enrollmentStatus]"
                    :tone="ENROLLMENT_STATUS_TONE[detail.enrollmentStatus]"
                  />
                </dd>
                <dt class="text-muted-foreground">最后更新</dt>
                <dd class="col-span-2">{{ formatDateTime(detail.updatedAt) }}</dd>
              </dl>
            </section>

            <Separator />

            <section class="space-y-2">
              <h3 class="text-sm font-semibold">账号</h3>
              <div class="rounded-md border p-2.5 text-sm">
                <p class="font-medium">{{ detail.account.realName }}</p>
                <p class="text-xs text-muted-foreground">{{ detail.account.email }}</p>
                <p class="mt-1 text-xs text-muted-foreground">
                  手机号：{{ orPlaceholder(detail.account.phone) }}
                </p>
              </div>
            </section>

            <Separator />

            <section class="space-y-2">
              <h3 class="text-sm font-semibold">分班历史</h3>
              <p v-if="detail.transfers.length === 0" class="text-sm text-muted-foreground">
                暂无分班记录。
              </p>
              <ol v-else class="space-y-2">
                <li
                  v-for="item in detail.transfers"
                  :key="item.id"
                  class="rounded-md border p-2.5 text-xs"
                >
                  <p class="text-sm">
                    {{ item.fromClassName ?? '未分班' }} → {{ item.toClassName }}
                  </p>
                  <p class="mt-1 text-muted-foreground">{{ item.reason }}</p>
                  <p class="mt-1 text-muted-foreground">
                    {{ formatDateTime(item.transferredAt) }}
                    <span v-if="item.transferredBy"> · {{ item.transferredBy.realName }}</span>
                  </p>
                </li>
              </ol>
            </section>
          </template>
        </div>
      </SheetContent>
    </Sheet>
  </BasicPage>
</template>
