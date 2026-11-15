import { apiRequest } from '@/lib/api-client'

import type {
  AssignableRole,
  AssignRoleInput,
  RoleAssignmentHistoryItem,
  RoleAssignmentItem,
  RoleTemplate,
} from '../types/rbac.type'

/** 角色模板列表（只读，用于展示角色说明） */
export function listRoles(): Promise<RoleTemplate[]> {
  return apiRequest<RoleTemplate[]>('/roles', { method: 'GET' })
}

/** 当前登录用户可分配的角色（已按角色矩阵与组织范围计算） */
export function listAssignableRoles(): Promise<AssignableRole[]> {
  return apiRequest<AssignableRole[]>('/role-assignments/assignable-roles', { method: 'GET' })
}

/** 指定用户的当前授权 */
export function listUserAssignments(userId: string): Promise<RoleAssignmentItem[]> {
  return apiRequest<RoleAssignmentItem[]>(`/role-assignments/users/${userId}`, { method: 'GET' })
}

/** 指定用户被撤销的授权历史（只追加，不可修改） */
export function listUserAssignmentHistory(userId: string): Promise<RoleAssignmentHistoryItem[]> {
  return apiRequest<RoleAssignmentHistoryItem[]>(`/role-assignments/users/${userId}/history`, {
    method: 'GET',
  })
}

export function assignRole(input: AssignRoleInput): Promise<RoleAssignmentItem> {
  return apiRequest<RoleAssignmentItem>('/role-assignments', {
    method: 'POST',
    body: input,
  })
}

/** 撤销成功时后端返回被撤销的授权行 id */
export function revokeRoleAssignment(id: string): Promise<string> {
  return apiRequest<string>(`/role-assignments/${id}`, { method: 'DELETE' })
}
