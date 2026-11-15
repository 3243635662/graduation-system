import { apiRequest } from '@/lib/api-client'
import { toQueryParams } from '@/lib/query'
import type { AuthUser, PaginatedData, UpdateMyProfileInput } from '@graduation/shared'

import type { UserAccountItem, UserListQuery } from '../types/rbac.type'

/**
 * 用户账号接口
 *
 * 注意：后端当前没有 PATCH /users/:id，
 * 因此账号管理页面只提供查询与详情，不提供修改（修改本人资料走 /users/me/profile）。
 */
export function listUsers(query: UserListQuery): Promise<PaginatedData<UserAccountItem>> {
  return apiRequest<PaginatedData<UserAccountItem>>('/users', {
    method: 'GET',
    query: toQueryParams(query),
  })
}

export function getUser(id: string): Promise<UserAccountItem> {
  return apiRequest<UserAccountItem>(`/users/${id}`, { method: 'GET' })
}

/** 修改本人公共资料；返回最新的 AuthUser，供 Store 同步 */
export function updateMyProfile(input: UpdateMyProfileInput): Promise<AuthUser> {
  return apiRequest<AuthUser>('/users/me/profile', {
    method: 'PATCH',
    body: input,
  })
}
