import { apiRequest } from '@/lib/api-client'
import { toQueryParams } from '@/lib/query'
import type { PaginatedData } from '@graduation/shared'

import type {
  ClassAffairsListQuery,
  CoordinatorOverrideItem,
  CounselorAssignmentItem,
  TeacherClassDutyItem,
} from '../types/class-affairs.type'

/** 班主任任职（只读列表，写操作在后续迭代中接入） */
export function listTeacherClassDuties(
  query: ClassAffairsListQuery,
): Promise<PaginatedData<TeacherClassDutyItem>> {
  return apiRequest<PaginatedData<TeacherClassDutyItem>>('/teacher-class-duties', {
    method: 'GET',
    query: toQueryParams(query),
  })
}

/** 辅导员班级分配（只读列表） */
export function listCounselorAssignments(
  query: ClassAffairsListQuery,
): Promise<PaginatedData<CounselorAssignmentItem>> {
  return apiRequest<PaginatedData<CounselorAssignmentItem>>('/counselor-class-assignments', {
    method: 'GET',
    query: toQueryParams(query),
  })
}

/** 协管员资格特殊覆盖授权（只读列表） */
export function listCoordinatorOverrides(
  query: ClassAffairsListQuery,
): Promise<PaginatedData<CoordinatorOverrideItem>> {
  return apiRequest<PaginatedData<CoordinatorOverrideItem>>('/coordinator-overrides', {
    method: 'GET',
    query: toQueryParams(query),
  })
}
