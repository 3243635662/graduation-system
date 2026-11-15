import { apiRequest } from '@/lib/api-client'
import { toQueryParams } from '@/lib/query'
import type { PaginatedData } from '@graduation/shared'

import type {
  CreatePersonnelProfileInput,
  EmploymentStatus,
  PersonnelListQuery,
  PersonnelProfileDetail,
  PersonnelProfileItem,
  UpdatePersonnelProfileInput,
} from '../types/rbac.type'

/** 工作人员档案接口 */
export function listPersonnel(
  query: PersonnelListQuery,
): Promise<PaginatedData<PersonnelProfileItem>> {
  return apiRequest<PaginatedData<PersonnelProfileItem>>('/personnel-profiles', {
    method: 'GET',
    query: toQueryParams(query),
  })
}

export function getPersonnel(id: string): Promise<PersonnelProfileDetail> {
  return apiRequest<PersonnelProfileDetail>(`/personnel-profiles/${id}`, { method: 'GET' })
}

export function createPersonnel(input: CreatePersonnelProfileInput): Promise<PersonnelProfileItem> {
  return apiRequest<PersonnelProfileItem>('/personnel-profiles', {
    method: 'POST',
    body: input,
  })
}

export function updatePersonnel(
  id: string,
  input: UpdatePersonnelProfileInput,
): Promise<PersonnelProfileItem> {
  return apiRequest<PersonnelProfileItem>(`/personnel-profiles/${id}`, {
    method: 'PATCH',
    body: input,
  })
}

export function updatePersonnelStatus(
  id: string,
  status: EmploymentStatus,
): Promise<PersonnelProfileItem> {
  return apiRequest<PersonnelProfileItem>(`/personnel-profiles/${id}/status`, {
    method: 'PATCH',
    body: { status },
  })
}
