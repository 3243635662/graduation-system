<script setup lang="ts">
/**
 * 学校与院系 /organizations
 *
 * 左侧组织树 + 右侧详情/编辑：
 * - 树来自 GET /organizations/tree（已按当前用户的数据范围裁剪）；
 * - 只允许修改名称、排序与启用状态（编码、类型、父节点不可变，与后端一致）；
 * - 新建节点只能在选中节点下创建下级。
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
import { Switch } from '@/components/ui/switch'
import { useOrganizationOptions } from '@/composables/use-organization-options'
import { useSubmitAction } from '@/composables/use-submit-action'
import { ORGANIZATION_STATUS_LABEL, ORGANIZATION_TYPE_LABEL } from '@/constants/rbac-labels'
import { createOrganization, updateOrganization } from '@/services/api/organizations.api'
import type { OrganizationNode, OrganizationType } from '@/services/types/rbac.type'
import {
  firstIssueMessage,
  organizationCreateSchema,
  organizationUpdateSchema,
} from '@/validators/rbac.schema'
import { Building2Icon, PlusIcon, RefreshCwIcon } from '@lucide/vue'
import { computed, ref, watch } from 'vue'
import { toast } from 'vue-sonner'

const { tree, options, loading, error, reload } = useOrganizationOptions()
const { submitting, submit } = useSubmitAction()

const selectedId = ref('')
const selectedNode = computed<OrganizationNode | null>(() => findNode(tree.value, selectedId.value))

function findNode(nodes: OrganizationNode[], id: string): OrganizationNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    const found = findNode(node.children ?? [], id)

    if (found) return found
  }

  return null
}

/** 树的扁平化渲染列表（用缩进表达层级，避免额外的递归组件） */
const treeRows = computed(() => options.value)

function selectNode(id: string): void {
  selectedId.value = id
  editForm.value = {
    name: selectedNode.value?.name ?? '',
    sortOrder: selectedNode.value ? String(selectedNode.value.sortOrder) : '',
  }
}

/** 首次加载后默认选中根节点，避免右侧长时间空着 */
watch(
  tree,
  (nodes) => {
    if (selectedId.value || nodes.length === 0) return

    selectNode(nodes[0].id)
  },
  { immediate: true },
)

// ——————————————————————————————————————————————
// 编辑名称与排序
// ——————————————————————————————————————————————

const editForm = ref({ name: '', sortOrder: '' })

async function submitEdit(): Promise<void> {
  const node = selectedNode.value

  if (!node) return

  const parsed = organizationUpdateSchema.safeParse(editForm.value)

  if (!parsed.success) {
    toast.error(firstIssueMessage(parsed.error))

    return
  }

  await submit(
    () =>
      updateOrganization(node.id, {
        name: parsed.data.name,
        ...(parsed.data.sortOrder === '' ? {} : { sortOrder: Number(parsed.data.sortOrder) }),
      }),
    {
      success: '组织节点已更新',
      onSuccess: () => {
        void reload()
      },
    },
  )
}

// ——————————————————————————————————————————————
// 启用 / 停用
// ——————————————————————————————————————————————

async function toggleStatus(next: boolean): Promise<void> {
  const node = selectedNode.value

  if (!node) return

  const status = next ? 'ACTIVE' : 'DISABLED'

  await submit(() => updateOrganization(node.id, { status }), {
    success: next ? '已启用该节点' : '已停用该节点',
    onSuccess: () => {
      void reload()
    },
  })
}

// ——————————————————————————————————————————————
// 新建子节点
// ——————————————————————————————————————————————

const createOpen = ref(false)
const createForm = ref({
  name: '',
  code: '',
  type: 'DEPARTMENT' as 'DEPARTMENT' | 'MAJOR' | 'CLASS',
  sortOrder: '',
})

/** 父节点类型 → 允许创建的下级类型 */
const CHILD_TYPE: Record<OrganizationType, Array<'DEPARTMENT' | 'MAJOR' | 'CLASS'>> = {
  SCHOOL: ['DEPARTMENT'],
  DEPARTMENT: ['MAJOR'],
  MAJOR: ['CLASS'],
  CLASS: [],
}

const childTypes = computed(() => (selectedNode.value ? CHILD_TYPE[selectedNode.value.type] : []))

const canCreateChild = computed(() => childTypes.value.length > 0)

function openCreate(): void {
  const firstType = childTypes.value[0]

  if (!firstType) return

  createForm.value = { name: '', code: '', type: firstType, sortOrder: '' }
  createOpen.value = true
}

function handleChildType(value: unknown): void {
  createForm.value.type = String(value) as typeof createForm.value.type
}

async function submitCreate(): Promise<void> {
  const parent = selectedNode.value

  if (!parent) return

  const parsed = organizationCreateSchema.safeParse(createForm.value)

  if (!parsed.success) {
    toast.error(firstIssueMessage(parsed.error))

    return
  }

  await submit(
    () =>
      createOrganization({
        name: parsed.data.name,
        code: parsed.data.code,
        type: parsed.data.type,
        parentId: parent.id,
        ...(parsed.data.sortOrder === '' ? {} : { sortOrder: Number(parsed.data.sortOrder) }),
      }),
    {
      success: '组织节点已创建',
      onSuccess: () => {
        createOpen.value = false
        void reload()
      },
    },
  )
}
</script>

<template>
  <BasicPage
    title="学校与院系"
    description="维护院系、专业与班级的层级结构；停用节点会同时影响其下级的数据可见性。"
  >
    <template #actions>
      <Button variant="outline" :disabled="loading" @click="reload">
        <RefreshCwIcon />
        刷新
      </Button>
      <Button :disabled="!canCreateChild" @click="openCreate">
        <PlusIcon />
        新建下级
      </Button>
    </template>

    <div class="grid gap-4 lg:grid-cols-[minmax(0,320px)_1fr]">
      <!-- 组织树 -->
      <Card class="h-fit">
        <CardHeader>
          <CardTitle class="text-base">组织架构</CardTitle>
          <CardDescription>仅展示当前账号有权限查看的节点。</CardDescription>
        </CardHeader>
        <CardContent class="p-0">
          <div v-if="loading" class="space-y-2 px-4 pb-4">
            <Skeleton v-for="index in 6" :key="index" class="h-9 w-full" />
          </div>

          <p v-else-if="error" class="px-4 pb-4 text-xs text-destructive">{{ error }}</p>

          <p v-else-if="treeRows.length === 0" class="px-4 pb-4 text-sm text-muted-foreground">
            没有可查看的组织节点。
          </p>

          <ul v-else class="max-h-[60vh] overflow-y-auto pb-2">
            <li v-for="row in treeRows" :key="row.id">
              <button
                type="button"
                class="flex w-full items-center gap-2 border-l-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60"
                :class="
                  row.id === selectedId
                    ? 'border-l-primary bg-muted/70 font-medium'
                    : 'border-l-transparent'
                "
                :style="{ paddingLeft: `${12 + row.depth * 14}px` }"
                @click="selectNode(row.id)"
              >
                <Building2Icon class="size-3.5 shrink-0 text-muted-foreground" />
                <span class="min-w-0 flex-1 truncate">{{ row.name }}</span>
                <span class="shrink-0 text-[10px] text-muted-foreground">
                  {{ ORGANIZATION_TYPE_LABEL[row.type] }}
                </span>
                <span
                  v-if="row.status === 'DISABLED'"
                  class="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground"
                >
                  停用
                </span>
              </button>
            </li>
          </ul>
        </CardContent>
      </Card>

      <!-- 详情 / 编辑 -->
      <Card class="h-fit">
        <CardHeader>
          <CardTitle class="text-base">节点详情</CardTitle>
          <CardDescription
            >编码、类型与上级节点不可修改；修改名称或排序会立即生效。</CardDescription
          >
        </CardHeader>

        <CardContent>
          <div v-if="!selectedNode" class="flex flex-col items-center gap-2 py-12 text-center">
            <Building2Icon class="size-8 text-muted-foreground" />
            <p class="text-sm font-medium">请选择左侧节点</p>
            <p class="text-xs text-muted-foreground">选择后可查看详情、修改名称与启用状态。</p>
          </div>

          <div v-else class="space-y-5">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p class="flex items-center gap-2 text-lg font-semibold">
                  {{ selectedNode.name }}
                  <StatusBadge
                    :label="ORGANIZATION_STATUS_LABEL[selectedNode.status]"
                    :tone="selectedNode.status === 'ACTIVE' ? 'success' : 'neutral'"
                  />
                </p>
                <p class="mt-1 text-xs text-muted-foreground">
                  {{ ORGANIZATION_TYPE_LABEL[selectedNode.type] }} · 编码
                  <span class="font-mono">{{ selectedNode.code }}</span>
                </p>
              </div>

              <div class="flex items-center gap-2">
                <span class="text-xs text-muted-foreground">启用</span>
                <Switch
                  :model-value="selectedNode.status === 'ACTIVE'"
                  :disabled="submitting"
                  @update:model-value="toggleStatus(Boolean($event))"
                />
              </div>
            </div>

            <Separator />

            <div class="grid gap-3 sm:grid-cols-2">
              <div class="space-y-1.5">
                <Label for="org-name">名称</Label>
                <Input
                  id="org-name"
                  :model-value="editForm.name"
                  @update:model-value="editForm.name = String($event)"
                />
              </div>
              <div class="space-y-1.5">
                <Label for="org-sort">排序</Label>
                <Input
                  id="org-sort"
                  :model-value="editForm.sortOrder"
                  inputmode="numeric"
                  placeholder="0-9999"
                  @update:model-value="editForm.sortOrder = String($event)"
                />
              </div>
            </div>

            <div class="flex flex-wrap items-center gap-2">
              <Button :disabled="submitting" @click="submitEdit">保存修改</Button>
              <Button variant="outline" :disabled="!canCreateChild" @click="openCreate">
                <PlusIcon />
                新建下级节点
              </Button>
            </div>

            <Separator />

            <dl class="grid grid-cols-3 gap-y-2 text-sm">
              <dt class="text-muted-foreground">节点类型</dt>
              <dd class="col-span-2">{{ ORGANIZATION_TYPE_LABEL[selectedNode.type] }}</dd>
              <dt class="text-muted-foreground">上级节点</dt>
              <dd class="col-span-2">
                {{
                  selectedNode.parentId
                    ? (options.find((item) => item.id === selectedNode?.parentId)?.name ?? '—')
                    : '根节点'
                }}
              </dd>
              <dt class="text-muted-foreground">直接下级</dt>
              <dd class="col-span-2">{{ selectedNode.children?.length ?? 0 }} 个</dd>
              <dt class="text-muted-foreground">节点 ID</dt>
              <dd class="col-span-2 font-mono text-[11px] break-all text-muted-foreground">
                {{ selectedNode.id }}
              </dd>
            </dl>
          </div>
        </CardContent>
      </Card>
    </div>

    <!-- 新建下级 -->
    <Dialog v-model:open="createOpen">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新建下级节点</DialogTitle>
          <DialogDescription>
            上级节点：{{ selectedNode?.name }}（{{
              selectedNode && ORGANIZATION_TYPE_LABEL[selectedNode.type]
            }}）
          </DialogDescription>
        </DialogHeader>

        <div class="space-y-3">
          <div class="space-y-1.5">
            <Label for="new-org-name">名称</Label>
            <Input
              id="new-org-name"
              :model-value="createForm.name"
              placeholder="例如计算机科学与技术"
              @update:model-value="createForm.name = String($event)"
            />
          </div>

          <div class="space-y-1.5">
            <Label for="new-org-code">编码</Label>
            <Input
              id="new-org-code"
              :model-value="createForm.code"
              placeholder="字母、数字、下划线或短横线"
              @update:model-value="createForm.code = String($event)"
            />
          </div>

          <div class="grid gap-3 sm:grid-cols-2">
            <div class="space-y-1.5">
              <Label>类型</Label>
              <Select :model-value="createForm.type" @update:model-value="handleChildType">
                <SelectTrigger class="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="type in childTypes" :key="type" :value="type">
                    {{ ORGANIZATION_TYPE_LABEL[type] }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div class="space-y-1.5">
              <Label for="new-org-sort">排序（可选）</Label>
              <Input
                id="new-org-sort"
                :model-value="createForm.sortOrder"
                inputmode="numeric"
                placeholder="0-9999"
                @update:model-value="createForm.sortOrder = String($event)"
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
  </BasicPage>
</template>
