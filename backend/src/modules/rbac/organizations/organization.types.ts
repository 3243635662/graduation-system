import type { OrganizationStatus, OrganizationType } from '../../../../generated/prisma/client.js'

/** 组织树的固定层级：SCHOOL → DEPARTMENT → MAJOR → CLASS */
export const ORGANIZATION_PARENT_TYPE: Readonly<Record<OrganizationType, OrganizationType | null>> =
  {
    SCHOOL: null,
    DEPARTMENT: 'SCHOOL',
    MAJOR: 'DEPARTMENT',
    CLASS: 'MAJOR',
  }

/** 组织树节点响应结构 */
export interface OrganizationTreeNode {
  id: string
  name: string
  code: string
  type: OrganizationType
  status: OrganizationStatus
  sortOrder: number
  parentId: string | null
  children: OrganizationTreeNode[]
}

/** 参与建树的最小字段集合 */
export interface OrganizationRow {
  id: string
  name: string
  code: string
  type: OrganizationType
  status: OrganizationStatus
  sortOrder: number
  parentId: string | null
}

export interface CreateOrganizationInput {
  name: string
  code: string
  type: OrganizationType
  parentId?: string | null
  sortOrder?: number
}

export interface UpdateOrganizationInput {
  name?: string
  sortOrder?: number
  status?: OrganizationStatus
}

/** 同级排序：sortOrder 升序，其次 code 码点升序（不依赖运行环境 ICU） */
function compareOrganization(a: OrganizationRow, b: OrganizationRow): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
  if (a.code === b.code) return 0

  return a.code < b.code ? -1 : 1
}

/**
 * 由邻接表行构建组织树。
 *
 * 规则：
 * 1. 停用节点及其整棵子树默认不返回（与菜单树一致，避免「父级停用但子级仍可见」）。
 * 2. 出现断链（父节点缺失）或循环引用时丢弃该节点，绝不把它提升为根节点。
 * 3. includeDisabled 为 true 时返回完整结构，供管理端查看与修复。
 * 4. allowMissingParent 用于「数据范围已经裁剪过」的查询：
 *    此时父节点不在结果集中是正常现象，应把该节点当作根节点返回，
 *    而不是把整棵子树丢弃。
 */
export function buildOrganizationTree(
  rows: OrganizationRow[],
  includeDisabled = false,
  allowMissingParent = false,
): OrganizationTreeNode[] {
  const candidates = includeDisabled ? rows : rows.filter((row) => row.status === 'ACTIVE')
  const byId = new Map(candidates.map((row) => [row.id, row]))

  /** 祖先链必须完整且全部可见，否则该节点不可用 */
  const hasIntactAncestry = (row: OrganizationRow): boolean => {
    const seen = new Set<string>([row.id])
    let cursor = row.parentId

    while (cursor) {
      if (seen.has(cursor)) return false

      seen.add(cursor)

      const parent = byId.get(cursor)

      if (!parent) return allowMissingParent

      cursor = parent.parentId
    }

    return true
  }

  const effective = candidates.filter(hasIntactAncestry)
  const childrenByParent = new Map<string, OrganizationRow[]>()

  for (const row of effective) {
    if (!row.parentId) continue

    const siblings = childrenByParent.get(row.parentId)

    if (siblings) siblings.push(row)
    else childrenByParent.set(row.parentId, [row])
  }

  const toNode = (row: OrganizationRow): OrganizationTreeNode => ({
    id: row.id,
    name: row.name,
    code: row.code,
    type: row.type,
    status: row.status,
    sortOrder: row.sortOrder,
    parentId: row.parentId,
    children: (childrenByParent.get(row.id) ?? []).toSorted(compareOrganization).map(toNode),
  })

  return effective
    .filter((row) => !row.parentId || !byId.has(row.parentId))
    .toSorted(compareOrganization)
    .map(toNode)
}
