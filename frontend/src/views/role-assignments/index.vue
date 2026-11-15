<script setup lang="ts">
/**
 * 角色授权 /role-assignments
 *
 * 交互顺序：先选定用户 → 查看当前授权与撤销历史 → 分配 / 撤销。
 *
 * 安全约束（都以后端为准，前端只做展示与提交）：
 * - 可分配角色来自 GET /role-assignments/assignable-roles，前端不硬编码角色矩阵；
 * - 角色范围必须与角色类型匹配（班级角色只能挂在班级节点上）；
 * - 撤销走 DELETE，后端会先写不可变历史再删除当前授权。
 */
import { BasicPage } from '@/components/global-layout'
import StatusBadge from '@/components/status-badge.vue'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { useOrganizationOptions } from '@/composables/use-organization-options'
import { useSubmitAction } from '@/composables/use-submit-action'
import {
  ORGANIZATION_TYPE_LABEL,
  USER_STATUS_LABEL,
  USER_STATUS_TONE,
} from '@/constants/rbac-labels'
import { formatDate, formatDateTime } from '@/lib/format'
import {
  assignRole,
  listAssignableRoles,
  listUserAssignmentHistory,
  listUserAssignments,
  revokeRoleAssignment,
} from '@/services/api/role-assignments.api'
import { listUsers } from '@/services/api/users.api'
import type {
  AssignableRole,
  RoleAssignmentHistoryItem,
  RoleAssignmentItem,
} from '@/services/types/rbac.type'
import type { UserAccountItem } from '@/services/types/rbac.type'
import { firstIssueMessage, roleAssignmentSchema } from '@/validators/rbac.schema'
import { SearchIcon, ShieldCheckIcon, ShieldOffIcon, UserRoundSearchIcon } from '@lucide/vue'
import { computed, onMounted, ref } from 'vue'
import { toast } from 'vue-sonner'

const { options: organizationOptions } = useOrganizationOptions()
const { submitting, submit } = useSubmitAction()

// ——————————————————————————————————————————————
// 选择用户
// ——————————————————————————————————————————————

const userKeyword = ref('')
const userLoading = ref(false)
const userError = ref('')
const userOptions = ref<UserAccountItem[]>([])
const selectedUser = ref<UserAccountItem | null>(null)

async function searchUsers(): Promise<void> {
  userLoading.value = true
  userError.value = ''

  try {
    const result = await listUsers({
      page: 1,
      pageSize: 10,
      keyword: userKeyword.value.trim() || undefined,
      status: 'ACTIVE',
    })

    userOptions.value = result.list
  } catch (rawError) {
    userOptions.value = []
    userError.value = rawError instanceof Error ? rawError.message : '搜索用户失败'
  } finally {
    userLoading.value = false
  }
}

function selectUser(user: UserAccountItem): void {
  selectedUser.value = user
  userOptions.value = []
  void loadAssignments(user.id)
}

function clearUser(): void {
  selectedUser.value = null
  assignments.value = []
  history.value = []
  void searchUsers()
}

// ——————————————————————————————————————————————
// 当前授权与历史
// ——————————————————————————————————————————————

const assignments = ref<RoleAssignmentItem[]>([])
const history = ref<RoleAssignmentHistoryItem[]>([])
const listLoading = ref(false)
const listError = ref('')

async function loadAssignments(userId: string): Promise<void> {
  listLoading.value = true
  listError.value = ''

  try {
    const [current, past] = await Promise.all([
      listUserAssignments(userId),
      listUserAssignmentHistory(userId),
    ])

    assignments.value = current
    history.value = past
  } catch (rawError) {
    assignments.value = []
    history.value = []
    listError.value = rawError instanceof Error ? rawError.message : '加载授权信息失败'
  } finally {
    listLoading.value = false
  }
}

function refreshSelected(): void {
  if (selectedUser.value) void loadAssignments(selectedUser.value.id)
}

// ——————————————————————————————————————————————
// 分配角色
// ——————————————————————————————————————————————

const assignOpen = ref(false)
const rolesLoading = ref(false)
const rolesError = ref('')
const assignableRoles = ref<AssignableRole[]>([])
const assignForm = ref({ roleCode: '', scopeOrgUnitId: '', validUntil: '' })

const selectedRole = computed(
  () => assignableRoles.value.find((role) => role.code === assignForm.value.roleCode) ?? null,
)

/** 角色要求的组织节点类型；为空表示该角色不绑定组织 */
const requiredScopeType = computed(() => selectedRole.value?.scopeType ?? null)

const scopeOptions = computed(() => {
  const type = requiredScopeType.value

  if (!type) return []

  return organizationOptions.value.filter((item) => item.type === type && item.status === 'ACTIVE')
})

async function openAssign(): Promise<void> {
  if (!selectedUser.value) {
    toast.error('请先选择用户')

    return
  }

  assignOpen.value = true
  assignForm.value = { roleCode: '', scopeOrgUnitId: '', validUntil: '' }

  if (assignableRoles.value.length > 0) return

  rolesLoading.value = true
  rolesError.value = ''

  try {
    assignableRoles.value = await listAssignableRoles()
  } catch (rawError) {
    rolesError.value = rawError instanceof Error ? rawError.message : '加载可分配角色失败'
  } finally {
    rolesLoading.value = false
  }
}

function handleRoleChange(value: unknown): void {
  assignForm.value.roleCode = String(value ?? '')
  // 角色变化后清空范围，避免把上个角色的组织节点带到新角色上
  assignForm.value.scopeOrgUnitId = ''
}

async function submitAssign(): Promise<void> {
  const user = selectedUser.value

  if (!user) return

  const parsed = roleAssignmentSchema.safeParse(assignForm.value)

  if (!parsed.success) {
    toast.error(firstIssueMessage(parsed.error))

    return
  }

  if (requiredScopeType.value && !parsed.data.scopeOrgUnitId) {
    toast.error(`该角色需要选择${ORGANIZATION_TYPE_LABEL[requiredScopeType.value]}范围`)

    return
  }

  const validUntil = parsed.data.validUntil
    ? new Date(`${parsed.data.validUntil}T23:59:59`).toISOString()
    : null

  await submit(
    () =>
      assignRole({
        userId: user.id,
        roleCode: parsed.data.roleCode,
        scopeOrgUnitId: requiredScopeType.value ? parsed.data.scopeOrgUnitId : null,
        validUntil,
      }),
    {
      success: '角色已分配',
      onSuccess: () => {
        assignOpen.value = false
        refreshSelected()
      },
    },
  )
}

// ——————————————————————————————————————————————
// 撤销
// ——————————————————————————————————————————————

const revokeOpen = ref(false)
const revokeTarget = ref<RoleAssignmentItem | null>(null)

function openRevoke(item: RoleAssignmentItem): void {
  revokeTarget.value = item
  revokeOpen.value = true
}

async function submitRevoke(): Promise<void> {
  const target = revokeTarget.value

  if (!target) return

  await submit(() => revokeRoleAssignment(target.id), {
    success: '角色授权已撤销',
    onSuccess: () => {
      revokeOpen.value = false
      refreshSelected()
    },
  })
}

onMounted(() => {
  void searchUsers()
})
</script>

<template>
  <BasicPage
    title="角色授权"
    description="为用户分配角色并限定组织范围；撤销会写入不可变历史，可随时回溯。"
  >
    <template #actions>
      <Button variant="outline" :disabled="listLoading || !selectedUser" @click="refreshSelected">
        刷新授权
      </Button>
      <Button :disabled="!selectedUser" @click="openAssign">
        <ShieldCheckIcon />
        分配角色
      </Button>
    </template>

    <div class="space-y-4">
      <!-- 选择用户 -->
      <Card>
        <CardHeader>
          <CardTitle class="text-base">选择用户</CardTitle>
          <CardDescription>按姓名或邮箱搜索，选定后展示该用户当前的角色授权。</CardDescription>
        </CardHeader>
        <CardContent class="space-y-3">
          <div v-if="selectedUser" class="flex flex-wrap items-center justify-between gap-3">
            <div class="min-w-0">
              <p class="truncate text-sm font-medium">
                {{ selectedUser.realName }}
                <StatusBadge
                  class="ml-1"
                  :label="USER_STATUS_LABEL[selectedUser.status]"
                  :tone="USER_STATUS_TONE[selectedUser.status]"
                />
              </p>
              <p class="truncate text-xs text-muted-foreground">{{ selectedUser.email }}</p>
            </div>
            <Button variant="ghost" size="sm" @click="clearUser">重新选择</Button>
          </div>

          <template v-else>
            <div class="flex gap-2">
              <div class="relative flex-1 sm:max-w-sm">
                <SearchIcon
                  class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  :model-value="userKeyword"
                  class="pl-9"
                  placeholder="搜索姓名或邮箱"
                  @update:model-value="userKeyword = String($event)"
                  @keyup.enter="searchUsers"
                />
              </div>
              <Button variant="outline" :disabled="userLoading" @click="searchUsers">搜索</Button>
            </div>

            <p v-if="userError" class="text-xs text-destructive">{{ userError }}</p>

            <div v-else-if="userLoading" class="space-y-1.5">
              <Skeleton v-for="index in 3" :key="index" class="h-12 w-full" />
            </div>

            <ul v-else-if="userOptions.length" class="grid gap-1.5 sm:grid-cols-2">
              <li v-for="user in userOptions" :key="user.id">
                <button
                  type="button"
                  class="flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left transition-colors hover:bg-accent"
                  @click="selectUser(user)"
                >
                  <span class="min-w-0">
                    <span class="block truncate text-sm font-medium">{{ user.realName }}</span>
                    <span class="block truncate text-xs text-muted-foreground">{{
                      user.email
                    }}</span>
                  </span>
                  <UserRoundSearchIcon class="size-4 shrink-0 text-muted-foreground" />
                </button>
              </li>
            </ul>

            <p v-else class="text-xs text-muted-foreground">没有匹配的用户。</p>
          </template>
        </CardContent>
      </Card>

      <!-- 当前授权 / 历史 -->
      <div v-if="selectedUser" class="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle class="text-base">当前授权</CardTitle>
            <CardDescription>只展示仍在生效记录表中的授权（撤销即删除）。</CardDescription>
          </CardHeader>
          <CardContent class="space-y-2">
            <div v-if="listError" class="text-xs text-destructive">{{ listError }}</div>

            <div v-else-if="listLoading" class="space-y-2">
              <Skeleton v-for="index in 3" :key="index" class="h-16 w-full" />
            </div>

            <p v-else-if="assignments.length === 0" class="text-sm text-muted-foreground">
              该用户当前没有可见的角色授权。
            </p>

            <ul v-else class="space-y-2">
              <li
                v-for="item in assignments"
                :key="item.id"
                class="rounded-md border p-3 transition-colors hover:bg-muted/40"
              >
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0">
                    <p class="flex items-center gap-1.5 text-sm font-medium">
                      {{ item.roleName }}
                      <span class="font-mono text-[10px] text-muted-foreground">{{
                        item.roleCode
                      }}</span>
                    </p>
                    <p class="mt-1 text-xs text-muted-foreground">
                      范围：{{ item.scopeOrgUnitName ?? '全局' }}
                      <span v-if="item.scopeOrgUnitType">
                        （{{ ORGANIZATION_TYPE_LABEL[item.scopeOrgUnitType] }}）
                      </span>
                    </p>
                    <p class="text-xs text-muted-foreground">
                      生效：{{ formatDate(item.validFrom) }} 至
                      {{ item.validUntil ? formatDate(item.validUntil) : '长期' }}
                    </p>
                  </div>
                  <div class="flex shrink-0 flex-col items-end gap-1.5">
                    <StatusBadge
                      :label="item.isEffective ? '已生效' : '未生效'"
                      :tone="item.isEffective ? 'success' : 'warning'"
                    />
                    <Button
                      variant="ghost"
                      size="xs"
                      class="text-destructive"
                      @click="openRevoke(item)"
                    >
                      <ShieldOffIcon />
                      撤销
                    </Button>
                  </div>
                </div>
              </li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle class="text-base">撤销历史</CardTitle>
            <CardDescription>历史只追加不修改，可完整回溯每一次撤销。</CardDescription>
          </CardHeader>
          <CardContent class="space-y-2">
            <div v-if="listLoading" class="space-y-2">
              <Skeleton v-for="index in 2" :key="index" class="h-14 w-full" />
            </div>

            <p v-else-if="history.length === 0" class="text-sm text-muted-foreground">
              暂无撤销记录。
            </p>

            <ul v-else class="max-h-96 space-y-2 overflow-y-auto pr-1">
              <li v-for="item in history" :key="item.id" class="rounded-md border p-3">
                <div class="flex items-start justify-between gap-2">
                  <div class="min-w-0">
                    <p class="text-sm font-medium">{{ item.roleName }}</p>
                    <p class="mt-1 text-xs text-muted-foreground">
                      范围：{{ item.scopeOrgUnitName ?? '全局' }}
                    </p>
                    <p class="text-xs text-muted-foreground">
                      撤销于 {{ formatDateTime(item.revokedAt) }}
                      <span v-if="item.revokedByName"> · {{ item.revokedByName }}</span>
                    </p>
                  </div>
                  <StatusBadge
                    :label="item.revocationReason === 'MANUAL' ? '手动撤销' : '资格失效'"
                    :tone="item.revocationReason === 'MANUAL' ? 'neutral' : 'warning'"
                  />
                </div>
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>

    <!-- 分配角色 -->
    <Dialog v-model:open="assignOpen">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>分配角色</DialogTitle>
          <DialogDescription>
            为 {{ selectedUser?.realName }} 分配角色，角色范围决定其可见数据与菜单。
          </DialogDescription>
        </DialogHeader>

        <div class="space-y-3">
          <div v-if="rolesError" class="text-xs text-destructive">{{ rolesError }}</div>

          <div class="space-y-1.5">
            <Label>角色</Label>
            <Select
              :model-value="assignForm.roleCode"
              :disabled="rolesLoading"
              @update:model-value="handleRoleChange"
            >
              <SelectTrigger class="w-full">
                <SelectValue :placeholder="rolesLoading ? '加载中…' : '请选择角色'" />
              </SelectTrigger>
              <SelectContent class="max-h-64">
                <SelectItem v-for="role in assignableRoles" :key="role.code" :value="role.code">
                  {{ role.name }}
                </SelectItem>
              </SelectContent>
            </Select>
            <p v-if="selectedRole" class="text-[11px] text-muted-foreground">
              数据范围：{{ selectedRole.dataScope }}
              <span v-if="requiredScopeType">
                · 需要指定{{ ORGANIZATION_TYPE_LABEL[requiredScopeType] }}
              </span>
              <span v-else>· 该角色不绑定组织节点</span>
            </p>
          </div>

          <div v-if="requiredScopeType" class="space-y-1.5">
            <Label>组织范围</Label>
            <Select
              :model-value="assignForm.scopeOrgUnitId"
              @update:model-value="assignForm.scopeOrgUnitId = String($event ?? '')"
            >
              <SelectTrigger class="w-full">
                <SelectValue placeholder="请选择组织节点" />
              </SelectTrigger>
              <SelectContent class="max-h-64">
                <SelectItem v-for="option in scopeOptions" :key="option.id" :value="option.id">
                  {{ option.path }}
                </SelectItem>
              </SelectContent>
            </Select>
            <p v-if="scopeOptions.length === 0" class="text-[11px] text-muted-foreground">
              当前可管理范围内没有该类型的组织节点。
            </p>
          </div>

          <div class="space-y-1.5">
            <Label for="valid-until">有效期至（可选）</Label>
            <Input
              id="valid-until"
              type="date"
              :model-value="assignForm.validUntil"
              @update:model-value="assignForm.validUntil = String($event)"
            />
            <p class="text-[11px] text-muted-foreground">留空表示长期有效。</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" :disabled="submitting" @click="assignOpen = false">取消</Button>
          <Button :disabled="submitting || rolesLoading" @click="submitAssign">确认分配</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- 撤销确认 -->
    <Dialog v-model:open="revokeOpen">
      <DialogContent class="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>撤销角色授权</DialogTitle>
          <DialogDescription>
            将撤销 {{ revokeTarget?.roleName }}
            <span v-if="revokeTarget?.scopeOrgUnitName"
              >（{{ revokeTarget.scopeOrgUnitName }}）</span
            >
            的授权，撤销后该用户会立即失去对应的权限与菜单入口。
          </DialogDescription>
        </DialogHeader>

        <Separator />

        <p class="text-xs text-muted-foreground">
          撤销记录会写入不可变历史，可在右侧「撤销历史」中查看。
        </p>

        <DialogFooter>
          <Button variant="outline" :disabled="submitting" @click="revokeOpen = false">取消</Button>
          <Button variant="destructive" :disabled="submitting" @click="submitRevoke">
            确认撤销
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </BasicPage>
</template>
