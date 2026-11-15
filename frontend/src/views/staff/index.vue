<script setup lang="ts">
/**
 * 教职工档案 /staff
 *
 * 两个 Tab 对应两套真实接口：
 * - 全部人员：工作人员档案（personnel-profiles），维护工号、岗位、正式组织归属与任职状态；
 * - 仅教师：教师档案（teacher-profiles），维护教师编号与职称，并可把工作人员提升为教师。
 *
 * 教师身份挂在工作人员档案下，因此「提升为教师」必须选择一个已存在的工作人员。
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useListQuery } from '@/composables/use-list-query'
import { useOrganizationOptions } from '@/composables/use-organization-options'
import { useSubmitAction } from '@/composables/use-submit-action'
import {
  EMPLOYMENT_STATUS_LABEL,
  EMPLOYMENT_STATUS_OPTIONS,
  EMPLOYMENT_STATUS_TONE,
  ORGANIZATION_TYPE_LABEL,
  USER_STATUS_LABEL,
  USER_STATUS_TONE,
} from '@/constants/rbac-labels'
import { formatDateTime, orPlaceholder } from '@/lib/format'
import * as personnelApi from '@/services/api/personnel.api'
import * as teachersApi from '@/services/api/teachers.api'
import type {
  EmploymentStatus,
  PersonnelListQuery,
  PersonnelProfileDetail,
  PersonnelProfileItem,
  TeacherListQuery,
  TeacherProfileItem,
  UserAccountItem,
} from '@/services/types/rbac.type'
import {
  firstIssueMessage,
  personnelCreateSchema,
  personnelEditSchema,
  teacherCreateSchema,
  teacherEditSchema,
  toOptionalText,
} from '@/validators/rbac.schema'
import { MoreHorizontalIcon, RefreshCwIcon, SearchIcon } from '@lucide/vue'
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'

import UserPicker from '../_shared/user-picker.vue'

type PersonnelFilters = Omit<PersonnelListQuery, 'page' | 'pageSize'>
type TeacherFilters = Omit<TeacherListQuery, 'page' | 'pageSize'>

const activeTab = ref('all')
const { staffOrganizationOptions } = useOrganizationOptions()
const { submitting, submit } = useSubmitAction()

// ——————————————————————————————————————————————
// Tab 1：工作人员
// ——————————————————————————————————————————————

const personnelKeyword = ref('')
const personnelStatus = ref('ALL')

const personnelList = useListQuery<PersonnelProfileItem, PersonnelFilters>({
  fetcher: (params) => personnelApi.listPersonnel(params),
  filters: () => ({
    keyword: personnelKeyword.value.trim() || undefined,
    status:
      personnelStatus.value === 'ALL' ? undefined : (personnelStatus.value as EmploymentStatus),
  }),
})

// 模板中直接使用的响应式引用（对象内嵌套的 ref 不会自动解包）
const personnelRows = personnelList.rows
const personnelTotal = personnelList.total
const personnelPage = personnelList.page
const personnelPageSize = personnelList.pageSize
const personnelLoading = personnelList.loading
const personnelError = personnelList.error

const personnelColumns: DataTableColumn[] = [
  { key: 'realName', title: '姓名', width: '110px' },
  { key: 'employeeNo', title: '工号', width: '110px' },
  { key: 'organizationName', title: '组织归属', width: '150px' },
  { key: 'positionName', title: '岗位', width: '130px', hideOnMobile: true },
  { key: 'status', title: '任职状态', width: '100px' },
  { key: 'teacherFlag', title: '教师身份', width: '110px' },
  { key: 'accountStatus', title: '账号状态', width: '100px', hideOnMobile: true },
  { key: 'actions', title: '操作', width: '70px', align: 'right' },
]

// ——————————————————————————————————————————————
// Tab 2：教师
// ——————————————————————————————————————————————

const teacherKeyword = ref('')
const teacherStatus = ref('ALL')

const teacherList = useListQuery<TeacherProfileItem, TeacherFilters>({
  fetcher: (params) => teachersApi.listTeachers(params),
  filters: () => ({
    keyword: teacherKeyword.value.trim() || undefined,
    employmentStatus:
      teacherStatus.value === 'ALL' ? undefined : (teacherStatus.value as EmploymentStatus),
  }),
})

const teacherRows = teacherList.rows
const teacherTotal = teacherList.total
const teacherPage = teacherList.page
const teacherPageSize = teacherList.pageSize
const teacherLoading = teacherList.loading
const teacherError = teacherList.error

const teacherColumns: DataTableColumn[] = [
  { key: 'realName', title: '姓名', width: '110px' },
  { key: 'teacherNo', title: '教师编号', width: '120px' },
  { key: 'title', title: '职称', width: '110px' },
  { key: 'organizationName', title: '组织归属', width: '150px' },
  { key: 'status', title: '在职状态', width: '100px' },
  { key: 'accountStatus', title: '账号状态', width: '100px', hideOnMobile: true },
  { key: 'actions', title: '操作', width: '70px', align: 'right' },
]

// ——————————————————————————————————————————————
// 工作人员：新建 / 编辑 / 状态
// ——————————————————————————————————————————————

const personnelCreateOpen = ref(false)
const personnelCreateUser = ref<UserAccountItem | null>(null)
const personnelCreateForm = ref({
  employeeNo: '',
  primaryOrganizationUnitId: '',
  positionName: '',
})

function openPersonnelCreate(): void {
  personnelCreateUser.value = null
  personnelCreateForm.value = { employeeNo: '', primaryOrganizationUnitId: '', positionName: '' }
  personnelCreateOpen.value = true
}

async function submitPersonnelCreate(): Promise<void> {
  const parsed = personnelCreateSchema.safeParse({
    userId: personnelCreateUser.value?.id ?? '',
    ...personnelCreateForm.value,
  })

  if (!parsed.success) {
    toast.error(firstIssueMessage(parsed.error))

    return
  }

  const ok = await submit(
    () =>
      personnelApi.createPersonnel({
        userId: parsed.data.userId,
        employeeNo: toOptionalText(parsed.data.employeeNo),
        primaryOrganizationUnitId: parsed.data.primaryOrganizationUnitId,
        positionName: toOptionalText(parsed.data.positionName),
      }),
    {
      success: '工作人员档案已创建',
      onSuccess: () => {
        personnelCreateOpen.value = false
        void personnelList.reload()
      },
    },
  )

  if (ok)
    personnelCreateForm.value = { employeeNo: '', primaryOrganizationUnitId: '', positionName: '' }
}

const personnelEditOpen = ref(false)
const personnelEditTarget = ref<PersonnelProfileItem | null>(null)
const personnelEditForm = ref({ employeeNo: '', positionName: '', primaryOrganizationUnitId: '' })

function openPersonnelEdit(row: PersonnelProfileItem): void {
  personnelEditTarget.value = row
  personnelEditForm.value = {
    employeeNo: row.employeeNo ?? '',
    positionName: row.positionName ?? '',
    primaryOrganizationUnitId: row.organizationId,
  }
  personnelEditOpen.value = true
}

async function submitPersonnelEdit(): Promise<void> {
  const target = personnelEditTarget.value

  if (!target) return

  const parsed = personnelEditSchema.safeParse(personnelEditForm.value)

  if (!parsed.success) {
    toast.error(firstIssueMessage(parsed.error))

    return
  }

  await submit(
    () =>
      personnelApi.updatePersonnel(target.id, {
        employeeNo: toOptionalText(parsed.data.employeeNo) ?? null,
        positionName: toOptionalText(parsed.data.positionName) ?? null,
        primaryOrganizationUnitId: parsed.data.primaryOrganizationUnitId,
      }),
    {
      success: '工作人员档案已更新',
      onSuccess: () => {
        personnelEditOpen.value = false
        void personnelList.reload()
        void teacherList.reload()
      },
    },
  )
}

const statusOpen = ref(false)
const statusMode = ref<'personnel' | 'teacher'>('personnel')
const statusTargetName = ref('')
const statusTargetId = ref('')
const nextStatus = ref<EmploymentStatus>('ACTIVE')

function openStatus(
  target: PersonnelProfileItem | TeacherProfileItem,
  mode: 'personnel' | 'teacher',
): void {
  statusMode.value = mode
  statusTargetId.value = target.id
  statusTargetName.value = `${target.realName}（${mode === 'personnel' ? ((target as PersonnelProfileItem).employeeNo ?? '无工号') : (target as TeacherProfileItem).teacherNo}）`
  nextStatus.value = target.status
  statusOpen.value = true
}

function handleNextStatus(value: unknown): void {
  nextStatus.value = String(value) as EmploymentStatus
}

async function submitStatus(): Promise<void> {
  await submit(
    () =>
      statusMode.value === 'personnel'
        ? personnelApi.updatePersonnelStatus(statusTargetId.value, nextStatus.value)
        : teachersApi.updateTeacherStatus(statusTargetId.value, nextStatus.value),
    {
      success: '任职状态已更新',
      onSuccess: () => {
        statusOpen.value = false
        void personnelList.reload()
        void teacherList.reload()
      },
    },
  )
}

// ——————————————————————————————————————————————
// 工作人员 / 教师详情
// ——————————————————————————————————————————————

const detailOpen = ref(false)
const detailLoading = ref(false)
const detailError = ref('')
const personnelDetail = ref<PersonnelProfileDetail | null>(null)

async function openPersonnelDetail(row: PersonnelProfileItem): Promise<void> {
  detailOpen.value = true
  detailLoading.value = true
  detailError.value = ''
  personnelDetail.value = null

  try {
    personnelDetail.value = await personnelApi.getPersonnel(row.id)
  } catch (rawError) {
    detailError.value = rawError instanceof Error ? rawError.message : '加载工作人员详情失败'
  } finally {
    detailLoading.value = false
  }
}

// ——————————————————————————————————————————————
// 提升为教师 / 编辑教师
// ——————————————————————————————————————————————

const teacherCreateOpen = ref(false)
const teacherCreateForm = ref({ personnelProfileId: '', teacherNo: '', title: '' })
/** 可提升的工作人员候选（未具备教师身份） */
const teacherCandidates = ref<PersonnelProfileItem[]>([])
const candidateKeyword = ref('')
const candidateLoading = ref(false)

async function searchCandidates(): Promise<void> {
  candidateLoading.value = true

  try {
    const result = await personnelApi.listPersonnel({
      page: 1,
      pageSize: 20,
      keyword: candidateKeyword.value.trim() || undefined,
      teacherOnly: false,
    })

    teacherCandidates.value = result.list.filter((item) => !item.isTeacher)
  } catch {
    teacherCandidates.value = []
  } finally {
    candidateLoading.value = false
  }
}

function openTeacherCreate(preselected?: PersonnelProfileItem): void {
  teacherCreateForm.value = {
    personnelProfileId: preselected?.id ?? '',
    teacherNo: preselected?.teacherNo ?? '',
    title: preselected?.title ?? '',
  }
  teacherCreateOpen.value = true
  void searchCandidates()
}

function chooseCandidate(item: PersonnelProfileItem): void {
  teacherCreateForm.value.personnelProfileId = item.id
  teacherCreateForm.value.teacherNo = item.employeeNo ?? ''
}

const selectedCandidate = computed(() =>
  teacherCandidates.value.find((item) => item.id === teacherCreateForm.value.personnelProfileId),
)

async function submitTeacherCreate(): Promise<void> {
  const parsed = teacherCreateSchema.safeParse(teacherCreateForm.value)

  if (!parsed.success) {
    toast.error(firstIssueMessage(parsed.error))

    return
  }

  await submit(
    () =>
      teachersApi.createTeacher({
        personnelProfileId: parsed.data.personnelProfileId,
        teacherNo: parsed.data.teacherNo,
        title: toOptionalText(parsed.data.title) ?? null,
      }),
    {
      success: '已为该工作人员创建教师身份',
      onSuccess: () => {
        teacherCreateOpen.value = false
        void personnelList.reload()
        void teacherList.reload()
      },
    },
  )
}

const teacherEditOpen = ref(false)
const teacherEditTarget = ref<TeacherProfileItem | null>(null)
const teacherEditForm = ref({ teacherNo: '', title: '' })

function openTeacherEdit(row: TeacherProfileItem): void {
  teacherEditTarget.value = row
  teacherEditForm.value = { teacherNo: row.teacherNo, title: row.title ?? '' }
  teacherEditOpen.value = true
}

async function submitTeacherEdit(): Promise<void> {
  const target = teacherEditTarget.value

  if (!target) return

  const parsed = teacherEditSchema.safeParse(teacherEditForm.value)

  if (!parsed.success) {
    toast.error(firstIssueMessage(parsed.error))

    return
  }

  await submit(
    () =>
      teachersApi.updateTeacher(target.id, {
        teacherNo: parsed.data.teacherNo,
        title: toOptionalText(parsed.data.title) ?? null,
      }),
    {
      success: '教师档案已更新',
      onSuccess: () => {
        teacherEditOpen.value = false
        void teacherList.reload()
        void personnelList.reload()
      },
    },
  )
}
</script>

<template>
  <BasicPage
    title="教职工档案"
    description="维护工作人员的工号、岗位与组织归属，并为在职人员创建教师身份。"
  >
    <template #actions>
      <Button
        variant="outline"
        :disabled="personnelLoading || teacherLoading"
        @click="
          () => {
            void personnelList.reload()
            void teacherList.reload()
          }
        "
      >
        <RefreshCwIcon />
        刷新
      </Button>
      <Button v-if="activeTab === 'all'" @click="openPersonnelCreate">新建工作人员</Button>
      <Button v-else @click="openTeacherCreate()">新增教师身份</Button>
    </template>

    <Tabs v-model="activeTab">
      <TabsList>
        <TabsTrigger value="all">全部人员</TabsTrigger>
        <TabsTrigger value="teachers">仅教师</TabsTrigger>
      </TabsList>

      <!-- 全部人员 -->
      <TabsContent value="all" class="space-y-4 pt-3">
        <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div class="relative flex-1 sm:max-w-xs">
            <SearchIcon
              class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              :model-value="personnelKeyword"
              class="pl-9"
              placeholder="搜索姓名、工号或邮箱"
              @update:model-value="personnelKeyword = String($event)"
              @keyup.enter="personnelList.search"
            />
          </div>

          <Select
            :model-value="personnelStatus"
            @update:model-value="
              (value) => {
                personnelStatus = String(value ?? 'ALL')
                void personnelList.search()
              }
            "
          >
            <SelectTrigger class="w-full sm:w-[140px]" aria-label="任职状态">
              <SelectValue placeholder="全部状态" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">全部状态</SelectItem>
              <SelectItem
                v-for="item in EMPLOYMENT_STATUS_OPTIONS"
                :key="item.value"
                :value="item.value"
              >
                {{ item.label }}
              </SelectItem>
            </SelectContent>
          </Select>

          <div class="flex items-center gap-2">
            <Button @click="personnelList.search">
              <SearchIcon />
              查询
            </Button>
            <Button
              variant="ghost"
              @click="
                () => {
                  personnelKeyword = ''
                  personnelStatus = 'ALL'
                  void personnelList.search()
                }
              "
            >
              重置
            </Button>
          </div>
        </div>

        <DataTable
          :columns="personnelColumns"
          :rows="personnelRows"
          :loading="personnelLoading"
          :error="personnelError"
          :total="personnelTotal"
          :page="personnelPage"
          :page-size="personnelPageSize"
          empty-title="没有匹配的工作人员"
          empty-description="调整筛选条件，或为账号创建工作人员档案。"
          @update:page="personnelList.changePage"
          @update:page-size="personnelList.changePageSize"
        >
          <template #cell-realName="{ row }">
            <span class="font-medium">{{ row.realName }}</span>
          </template>

          <template #cell-employeeNo="{ row }">
            <span class="font-mono text-xs">{{ orPlaceholder(row.employeeNo) }}</span>
          </template>

          <template #cell-organizationName="{ row }">
            <div class="flex flex-col">
              <span>{{ row.organizationName }}</span>
              <span class="text-[11px] text-muted-foreground">
                {{ ORGANIZATION_TYPE_LABEL[row.organizationType] }}
              </span>
            </div>
          </template>

          <template #cell-positionName="{ row }">
            <span class="text-muted-foreground">{{ orPlaceholder(row.positionName) }}</span>
          </template>

          <template #cell-status="{ row }">
            <StatusBadge
              :label="EMPLOYMENT_STATUS_LABEL[row.status]"
              :tone="EMPLOYMENT_STATUS_TONE[row.status]"
            />
          </template>

          <template #cell-teacherFlag="{ row }">
            <Badge v-if="row.isTeacher" variant="secondary" class="font-normal">
              教师 · {{ row.teacherNo ?? '未编号' }}
            </Badge>
            <span v-else class="text-xs text-muted-foreground">普通人员</span>
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
              <DropdownMenuContent align="end" class="w-44">
                <DropdownMenuItem @click="openPersonnelDetail(row)">查看详情</DropdownMenuItem>
                <DropdownMenuItem @click="openPersonnelEdit(row)">编辑档案</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem v-if="!row.isTeacher" @click="openTeacherCreate(row)">
                  提升为教师
                </DropdownMenuItem>
                <DropdownMenuItem @click="openStatus(row, 'personnel')"
                  >修改任职状态</DropdownMenuItem
                >
              </DropdownMenuContent>
            </DropdownMenu>
          </template>
        </DataTable>
      </TabsContent>

      <!-- 仅教师 -->
      <TabsContent value="teachers" class="space-y-4 pt-3">
        <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div class="relative flex-1 sm:max-w-xs">
            <SearchIcon
              class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              :model-value="teacherKeyword"
              class="pl-9"
              placeholder="搜索姓名、教师编号"
              @update:model-value="teacherKeyword = String($event)"
              @keyup.enter="teacherList.search"
            />
          </div>

          <Select
            :model-value="teacherStatus"
            @update:model-value="
              (value) => {
                teacherStatus = String(value ?? 'ALL')
                void teacherList.search()
              }
            "
          >
            <SelectTrigger class="w-full sm:w-[140px]" aria-label="在职状态">
              <SelectValue placeholder="全部状态" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">全部状态</SelectItem>
              <SelectItem
                v-for="item in EMPLOYMENT_STATUS_OPTIONS"
                :key="item.value"
                :value="item.value"
              >
                {{ item.label }}
              </SelectItem>
            </SelectContent>
          </Select>

          <div class="flex items-center gap-2">
            <Button @click="teacherList.search">
              <SearchIcon />
              查询
            </Button>
            <Button
              variant="ghost"
              @click="
                () => {
                  teacherKeyword = ''
                  teacherStatus = 'ALL'
                  void teacherList.search()
                }
              "
            >
              重置
            </Button>
          </div>
        </div>

        <DataTable
          :columns="teacherColumns"
          :rows="teacherRows"
          :loading="teacherLoading"
          :error="teacherError"
          :total="teacherTotal"
          :page="teacherPage"
          :page-size="teacherPageSize"
          empty-title="还没有教师档案"
          empty-description="在「全部人员」中把工作人员提升为教师。"
          @update:page="teacherList.changePage"
          @update:page-size="teacherList.changePageSize"
        >
          <template #cell-realName="{ row }">
            <span class="font-medium">{{ row.realName }}</span>
          </template>

          <template #cell-teacherNo="{ row }">
            <span class="font-mono text-xs">{{ row.teacherNo }}</span>
          </template>

          <template #cell-title="{ row }">
            <span class="text-muted-foreground">{{ orPlaceholder(row.title) }}</span>
          </template>

          <template #cell-organizationName="{ row }">
            <div class="flex flex-col">
              <span>{{ row.organizationName }}</span>
              <span class="text-[11px] text-muted-foreground">
                {{ ORGANIZATION_TYPE_LABEL[row.organizationType] }}
              </span>
            </div>
          </template>

          <template #cell-status="{ row }">
            <StatusBadge
              :label="EMPLOYMENT_STATUS_LABEL[row.status]"
              :tone="EMPLOYMENT_STATUS_TONE[row.status]"
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
              <DropdownMenuContent align="end" class="w-36">
                <DropdownMenuItem @click="openTeacherEdit(row)">编辑教师档案</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem @click="openStatus(row, 'teacher')"
                  >修改在职状态</DropdownMenuItem
                >
              </DropdownMenuContent>
            </DropdownMenu>
          </template>
        </DataTable>
      </TabsContent>
    </Tabs>

    <!-- 新建工作人员 -->
    <Dialog v-model:open="personnelCreateOpen">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>新建工作人员档案</DialogTitle>
          <DialogDescription>先选择账号，再指定正式组织归属（院系或专业）。</DialogDescription>
        </DialogHeader>

        <div class="space-y-4">
          <div class="space-y-1.5">
            <Label>绑定账号</Label>
            <UserPicker v-model="personnelCreateUser" :disabled="submitting" />
          </div>

          <div class="space-y-1.5">
            <Label>正式组织归属</Label>
            <Select
              :model-value="personnelCreateForm.primaryOrganizationUnitId"
              @update:model-value="
                personnelCreateForm.primaryOrganizationUnitId = String($event ?? '')
              "
            >
              <SelectTrigger class="w-full">
                <SelectValue placeholder="请选择院系或专业" />
              </SelectTrigger>
              <SelectContent class="max-h-64">
                <SelectItem
                  v-for="option in staffOrganizationOptions"
                  :key="option.id"
                  :value="option.id"
                >
                  {{ option.path }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div class="grid gap-3 sm:grid-cols-2">
            <div class="space-y-1.5">
              <Label for="employee-no">工号（可选）</Label>
              <Input
                id="employee-no"
                :model-value="personnelCreateForm.employeeNo"
                @update:model-value="personnelCreateForm.employeeNo = String($event)"
              />
            </div>
            <div class="space-y-1.5">
              <Label for="position-name">岗位（可选）</Label>
              <Input
                id="position-name"
                :model-value="personnelCreateForm.positionName"
                placeholder="例如教务干事"
                @update:model-value="personnelCreateForm.positionName = String($event)"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" :disabled="submitting" @click="personnelCreateOpen = false">
            取消
          </Button>
          <Button :disabled="submitting" @click="submitPersonnelCreate">创建</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- 编辑工作人员 -->
    <Dialog v-model:open="personnelEditOpen">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>编辑工作人员档案</DialogTitle>
          <DialogDescription>{{ personnelEditTarget?.realName }}</DialogDescription>
        </DialogHeader>

        <div class="space-y-3">
          <div class="space-y-1.5">
            <Label for="edit-employee-no">工号</Label>
            <Input
              id="edit-employee-no"
              :model-value="personnelEditForm.employeeNo"
              placeholder="留空表示清空工号"
              @update:model-value="personnelEditForm.employeeNo = String($event)"
            />
          </div>
          <div class="space-y-1.5">
            <Label for="edit-position-name">岗位</Label>
            <Input
              id="edit-position-name"
              :model-value="personnelEditForm.positionName"
              @update:model-value="personnelEditForm.positionName = String($event)"
            />
          </div>
          <div class="space-y-1.5">
            <Label>正式组织归属</Label>
            <Select
              :model-value="personnelEditForm.primaryOrganizationUnitId"
              @update:model-value="
                personnelEditForm.primaryOrganizationUnitId = String($event ?? '')
              "
            >
              <SelectTrigger class="w-full">
                <SelectValue placeholder="请选择院系或专业" />
              </SelectTrigger>
              <SelectContent class="max-h-64">
                <SelectItem
                  v-for="option in staffOrganizationOptions"
                  :key="option.id"
                  :value="option.id"
                >
                  {{ option.path }}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" :disabled="submitting" @click="personnelEditOpen = false">
            取消
          </Button>
          <Button :disabled="submitting" @click="submitPersonnelEdit">保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- 任职状态 -->
    <Dialog v-model:open="statusOpen">
      <DialogContent class="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>修改任职状态</DialogTitle>
          <DialogDescription>{{ statusTargetName }}</DialogDescription>
        </DialogHeader>

        <Select :model-value="nextStatus" @update:model-value="handleNextStatus">
          <SelectTrigger class="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              v-for="item in EMPLOYMENT_STATUS_OPTIONS"
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

    <!-- 新增教师身份 -->
    <Dialog v-model:open="teacherCreateOpen">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>新增教师身份</DialogTitle>
          <DialogDescription>
            教师身份挂在工作人员档案下，请先选择一名尚未具备教师身份的工作人员。
          </DialogDescription>
        </DialogHeader>

        <div class="space-y-4">
          <div class="space-y-1.5">
            <Label>工作人员</Label>
            <div class="flex gap-2">
              <Input
                :model-value="candidateKeyword"
                placeholder="搜索姓名或工号"
                @update:model-value="candidateKeyword = String($event)"
                @keyup.enter="searchCandidates"
              />
              <Button variant="outline" :disabled="candidateLoading" @click="searchCandidates">
                搜索
              </Button>
            </div>
            <div v-if="selectedCandidate" class="rounded-md border bg-muted/40 px-3 py-2 text-sm">
              <p class="font-medium">{{ selectedCandidate.realName }}</p>
              <p class="text-xs text-muted-foreground">
                {{ selectedCandidate.organizationName }} ·
                {{ orPlaceholder(selectedCandidate.employeeNo) }}
              </p>
            </div>
            <ul v-else class="max-h-40 space-y-1 overflow-y-auto">
              <li v-for="item in teacherCandidates" :key="item.id">
                <button
                  type="button"
                  class="flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
                  @click="chooseCandidate(item)"
                >
                  <span class="font-medium">{{ item.realName }}</span>
                  <span class="text-xs text-muted-foreground">
                    {{ orPlaceholder(item.employeeNo) }}
                  </span>
                </button>
              </li>
              <li
                v-if="!candidateLoading && teacherCandidates.length === 0"
                class="text-xs text-muted-foreground"
              >
                没有可选的工作人员（可能都已是教师）。
              </li>
            </ul>
          </div>

          <div class="grid gap-3 sm:grid-cols-2">
            <div class="space-y-1.5">
              <Label for="teacher-no">教师编号</Label>
              <Input
                id="teacher-no"
                :model-value="teacherCreateForm.teacherNo"
                @update:model-value="teacherCreateForm.teacherNo = String($event)"
              />
            </div>
            <div class="space-y-1.5">
              <Label for="teacher-title">职称（可选）</Label>
              <Input
                id="teacher-title"
                :model-value="teacherCreateForm.title"
                placeholder="例如副教授"
                @update:model-value="teacherCreateForm.title = String($event)"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" :disabled="submitting" @click="teacherCreateOpen = false">
            取消
          </Button>
          <Button :disabled="submitting" @click="submitTeacherCreate">创建</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- 编辑教师 -->
    <Dialog v-model:open="teacherEditOpen">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>编辑教师档案</DialogTitle>
          <DialogDescription>{{ teacherEditTarget?.realName }}</DialogDescription>
        </DialogHeader>

        <div class="space-y-3">
          <div class="space-y-1.5">
            <Label for="edit-teacher-no">教师编号</Label>
            <Input
              id="edit-teacher-no"
              :model-value="teacherEditForm.teacherNo"
              @update:model-value="teacherEditForm.teacherNo = String($event)"
            />
          </div>
          <div class="space-y-1.5">
            <Label for="edit-teacher-title">职称</Label>
            <Input
              id="edit-teacher-title"
              :model-value="teacherEditForm.title"
              @update:model-value="teacherEditForm.title = String($event)"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" :disabled="submitting" @click="teacherEditOpen = false">
            取消
          </Button>
          <Button :disabled="submitting" @click="submitTeacherEdit">保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- 工作人员详情 -->
    <Sheet v-model:open="detailOpen">
      <SheetContent class="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>工作人员详情</SheetTitle>
          <SheetDescription>档案、账号摘要与教师身份信息。</SheetDescription>
        </SheetHeader>

        <div class="flex-1 space-y-4 overflow-y-auto px-4 pb-4">
          <div v-if="detailLoading" class="space-y-2">
            <Skeleton class="h-4 w-1/2" />
            <Skeleton class="h-4 w-2/3" />
            <Skeleton class="h-20 w-full" />
          </div>

          <p v-else-if="detailError" class="text-sm text-destructive">{{ detailError }}</p>

          <template v-else-if="personnelDetail">
            <dl class="grid grid-cols-3 gap-y-2 text-sm">
              <dt class="text-muted-foreground">姓名</dt>
              <dd class="col-span-2 font-medium">{{ personnelDetail.account.realName }}</dd>
              <dt class="text-muted-foreground">邮箱</dt>
              <dd class="col-span-2 break-all">{{ personnelDetail.account.email }}</dd>
              <dt class="text-muted-foreground">工号</dt>
              <dd class="col-span-2 font-mono text-xs">
                {{ orPlaceholder(personnelDetail.employeeNo) }}
              </dd>
              <dt class="text-muted-foreground">岗位</dt>
              <dd class="col-span-2">{{ orPlaceholder(personnelDetail.positionName) }}</dd>
              <dt class="text-muted-foreground">组织归属</dt>
              <dd class="col-span-2">{{ personnelDetail.organization.name }}</dd>
              <dt class="text-muted-foreground">任职状态</dt>
              <dd class="col-span-2">
                <StatusBadge
                  :label="EMPLOYMENT_STATUS_LABEL[personnelDetail.status]"
                  :tone="EMPLOYMENT_STATUS_TONE[personnelDetail.status]"
                />
              </dd>
              <dt class="text-muted-foreground">最近更新</dt>
              <dd class="col-span-2">{{ formatDateTime(personnelDetail.updatedAt) }}</dd>
            </dl>

            <div class="space-y-2">
              <h3 class="text-sm font-semibold">教师身份</h3>
              <div v-if="personnelDetail.teacherProfile" class="rounded-md border p-2.5 text-sm">
                <p>教师编号：{{ personnelDetail.teacherProfile.teacherNo }}</p>
                <p class="text-muted-foreground">
                  职称：{{ orPlaceholder(personnelDetail.teacherProfile.title) }}
                </p>
              </div>
              <p v-else class="text-sm text-muted-foreground">
                尚未创建教师身份，可在操作中「提升为教师」。
              </p>
            </div>
          </template>
        </div>
      </SheetContent>
    </Sheet>
  </BasicPage>
</template>
