import { apiRequest } from '@/lib/api-client'
import { toQueryParams } from '@/lib/query'
import type { PaginatedData } from '@graduation/shared'

import type {
  CreateStudentProfileInput,
  EnrollmentStatus,
  StudentListQuery,
  StudentProfileDetail,
  StudentProfileItem,
  TransferStudentInput,
  UpdateStudentProfileInput,
} from '../types/rbac.type'

/** 学生档案接口 */
export function listStudents(query: StudentListQuery): Promise<PaginatedData<StudentProfileItem>> {
  return apiRequest<PaginatedData<StudentProfileItem>>('/student-profiles', {
    method: 'GET',
    query: toQueryParams(query),
  })
}

export function getStudent(id: string): Promise<StudentProfileDetail> {
  return apiRequest<StudentProfileDetail>(`/student-profiles/${id}`, { method: 'GET' })
}

export function createStudent(input: CreateStudentProfileInput): Promise<StudentProfileItem> {
  return apiRequest<StudentProfileItem>('/student-profiles', {
    method: 'POST',
    body: input,
  })
}

export function updateStudent(
  id: string,
  input: UpdateStudentProfileInput,
): Promise<StudentProfileItem> {
  return apiRequest<StudentProfileItem>(`/student-profiles/${id}`, {
    method: 'PATCH',
    body: input,
  })
}

/** 首次分班与转班共用一个接口，都会写入分班/转班历史 */
export function transferStudent(
  id: string,
  input: TransferStudentInput,
): Promise<StudentProfileItem> {
  return apiRequest<StudentProfileItem>(`/student-profiles/${id}/transfer`, {
    method: 'POST',
    body: input,
  })
}

export function updateStudentStatus(
  id: string,
  enrollmentStatus: EnrollmentStatus,
): Promise<StudentProfileItem> {
  return apiRequest<StudentProfileItem>(`/student-profiles/${id}/status`, {
    method: 'PATCH',
    body: { enrollmentStatus },
  })
}
