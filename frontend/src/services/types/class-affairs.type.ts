import type { PaginationQuery, UserStatus } from '@graduation/shared'

import type { AssignmentRecordStatus } from './rbac.type'

/**
 * 班级事务（班主任任职 / 辅导员分配 / 协管员特殊授权）查询类型
 *
 * 这三类记录都是只读列表 + 独立撤销接口，
 * 因此列表项统一返回「谁 + 哪个班级 + 有效期 + 是否生效」。
 */

export interface ClassAffairsListQuery extends PaginationQuery {
  userId?: string
  teacherId?: string
  classId?: string
  status?: AssignmentRecordStatus
}

/** GET /teacher-class-duties */
export interface TeacherClassDutyItem {
  id: string
  teacherId: string
  teacherNo: string
  teacherName: string
  teacherEmail: string
  classId: string
  className: string
  classCode: string
  dutyType: string
  validFrom: string
  validUntil: string | null
  revokedAt: string | null
  revokedById: string | null
  isEffective: boolean
}

/** GET /counselor-class-assignments */
export interface CounselorAssignmentItem {
  id: string
  userId: string
  userName: string
  userEmail: string
  userStatus: UserStatus
  classId: string
  className: string
  classCode: string
  validFrom: string
  validUntil: string | null
  revokedAt: string | null
  revokedById: string | null
  isEffective: boolean
}

/** GET /coordinator-overrides */
export interface CoordinatorOverrideItem {
  id: string
  userId: string
  userName: string
  userEmail: string
  classId: string
  className: string
  classCode: string
  reason: string | null
  validFrom: string
  validUntil: string | null
  revokedAt: string | null
  revokedById: string | null
  revokedByName: string | null
  grantedById: string
  grantedByName: string
  isEffective: boolean
}
