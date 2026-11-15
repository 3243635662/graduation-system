import { apiRequest } from '@/lib/api-client'

import type {
  CreateOrganizationInput,
  OrganizationNode,
  UpdateOrganizationInput,
} from '../types/rbac.type'

/** 组织架构接口（返回结果已按当前用户的数据范围裁剪） */
export function getOrganizationTree(includeDisabled = true): Promise<OrganizationNode[]> {
  return apiRequest<OrganizationNode[]>('/organizations/tree', {
    method: 'GET',
    query: { includeDisabled: String(includeDisabled) },
  })
}

export function getOrganization(id: string): Promise<OrganizationNode> {
  return apiRequest<OrganizationNode>(`/organizations/${id}`, { method: 'GET' })
}

export function createOrganization(input: CreateOrganizationInput): Promise<OrganizationNode> {
  return apiRequest<OrganizationNode>('/organizations', {
    method: 'POST',
    body: input,
  })
}

/** 只允许修改名称、排序与启用状态；编码、类型与父节点不可变 */
export function updateOrganization(
  id: string,
  input: UpdateOrganizationInput,
): Promise<OrganizationNode> {
  return apiRequest<OrganizationNode>(`/organizations/${id}`, {
    method: 'PATCH',
    body: input,
  })
}
