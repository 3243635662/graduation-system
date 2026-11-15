import { getOrganizationTree } from '@/services/api/organizations.api'
import type { OrganizationNode, OrganizationType } from '@/services/types/rbac.type'
import { computed, onMounted, ref, shallowRef } from 'vue'

/** 扁平化后的组织节点，便于放进下拉框 */
export interface OrganizationOption {
  id: string
  name: string
  type: OrganizationType
  status: OrganizationNode['status']
  /** 从根到当前节点的完整名称，用于区分同名节点 */
  path: string
  depth: number
}

/** 可作为「工作人员正式组织归属」的节点类型（班级不行） */
const STAFF_ORGANIZATION_TYPES: OrganizationType[] = ['SCHOOL', 'DEPARTMENT', 'MAJOR']

function flatten(nodes: OrganizationNode[], parentPath = '', depth = 0): OrganizationOption[] {
  return nodes.flatMap((node) => {
    const path = parentPath ? `${parentPath} / ${node.name}` : node.name

    return [
      { id: node.id, name: node.name, type: node.type, status: node.status, path, depth },
      ...flatten(node.children ?? [], path, depth + 1),
    ]
  })
}

/**
 * 组织树选项
 *
 * 多个页面需要「班级 / 院系」下拉，统一在这里加载与扁平化。
 * 默认包含已停用节点（用于管理页展示），但选择框里会过滤掉停用节点。
 */
export function useOrganizationOptions() {
  const tree = shallowRef<OrganizationNode[]>([])
  const loading = ref(false)
  const error = ref('')

  async function load(): Promise<void> {
    loading.value = true
    error.value = ''

    try {
      tree.value = await getOrganizationTree(true)
    } catch (rawError) {
      tree.value = []
      error.value = rawError instanceof Error ? rawError.message : '加载组织架构失败'
    } finally {
      loading.value = false
    }
  }

  const options = computed(() => flatten(tree.value))

  /** 可选的班级（只保留启用的节点） */
  const classOptions = computed(() =>
    options.value.filter((item) => item.type === 'CLASS' && item.status === 'ACTIVE'),
  )

  /** 可选的正式组织归属（学校 / 院系 / 专业） */
  const staffOrganizationOptions = computed(() =>
    options.value.filter(
      (item) => STAFF_ORGANIZATION_TYPES.includes(item.type) && item.status === 'ACTIVE',
    ),
  )

  onMounted(() => {
    void load()
  })

  return {
    tree,
    options,
    classOptions,
    staffOrganizationOptions,
    loading,
    error,
    reload: load,
  }
}
