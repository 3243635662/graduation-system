import { apiRequest } from '@/lib/api-client'
import { toQueryParams } from '@/lib/query'
import type { PaginatedData } from '@graduation/shared'

import type {
  CreateTeacherProfileInput,
  EmploymentStatus,
  TeacherListQuery,
  TeacherProfileDetail,
  TeacherProfileItem,
  UpdateTeacherProfileInput,
} from '../types/rbac.type'

/** 教师档案接口 */
export function listTeachers(query: TeacherListQuery): Promise<PaginatedData<TeacherProfileItem>> {
  return apiRequest<PaginatedData<TeacherProfileItem>>('/teacher-profiles', {
    method: 'GET',
    query: toQueryParams(query),
  })
}

export function getTeacher(id: string): Promise<TeacherProfileDetail> {
  return apiRequest<TeacherProfileDetail>(`/teacher-profiles/${id}`, { method: 'GET' })
}

/** 把已存在的工作人员档案提升为教师身份 */
export function createTeacher(input: CreateTeacherProfileInput): Promise<TeacherProfileItem> {
  return apiRequest<TeacherProfileItem>('/teacher-profiles', {
    method: 'POST',
    body: input,
  })
}

export function updateTeacher(
  id: string,
  input: UpdateTeacherProfileInput,
): Promise<TeacherProfileItem> {
  return apiRequest<TeacherProfileItem>(`/teacher-profiles/${id}`, {
    method: 'PATCH',
    body: input,
  })
}

export function updateTeacherStatus(
  id: string,
  employmentStatus: EmploymentStatus,
): Promise<TeacherProfileItem> {
  return apiRequest<TeacherProfileItem>(`/teacher-profiles/${id}/status`, {
    method: 'PATCH',
    body: { employmentStatus },
  })
}
