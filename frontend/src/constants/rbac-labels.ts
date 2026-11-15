import type {
  AssignmentRecordStatus,
  EmploymentStatus,
  EnrollmentStatus,
  OrganizationStatus,
  OrganizationType,
} from '@/services/types/rbac.type'
import type { UserStatus } from '@graduation/shared'

/**
 * 状态展示文案与色调
 *
 * 后端返回的是枚举编码，界面统一在这里映射成中文与色调，
 * 避免每个页面各写一份 switch，也方便后续接入 i18n。
 */
export type StatusTone = 'success' | 'info' | 'warning' | 'danger' | 'neutral'

export const USER_STATUS_LABEL: Record<UserStatus, string> = {
  ACTIVE: '正常',
  DISABLED: '已停用',
  LOCKED: '已锁定',
}

export const USER_STATUS_TONE: Record<UserStatus, StatusTone> = {
  ACTIVE: 'success',
  DISABLED: 'neutral',
  LOCKED: 'danger',
}

export const EMPLOYMENT_STATUS_LABEL: Record<EmploymentStatus, string> = {
  ACTIVE: '在职',
  ON_LEAVE: '休假',
  LEFT: '离职',
}

export const EMPLOYMENT_STATUS_TONE: Record<EmploymentStatus, StatusTone> = {
  ACTIVE: 'success',
  ON_LEAVE: 'warning',
  LEFT: 'neutral',
}

export const ENROLLMENT_STATUS_LABEL: Record<EnrollmentStatus, string> = {
  ACTIVE: '在籍',
  SUSPENDED: '休学',
  GRADUATED: '毕业',
  WITHDRAWN: '退学',
}

export const ENROLLMENT_STATUS_TONE: Record<EnrollmentStatus, StatusTone> = {
  ACTIVE: 'success',
  SUSPENDED: 'warning',
  GRADUATED: 'info',
  WITHDRAWN: 'danger',
}

export const ORGANIZATION_TYPE_LABEL: Record<OrganizationType, string> = {
  SCHOOL: '学校',
  DEPARTMENT: '院系',
  MAJOR: '专业',
  CLASS: '班级',
}

export const ORGANIZATION_STATUS_LABEL: Record<OrganizationStatus, string> = {
  ACTIVE: '启用',
  DISABLED: '停用',
}

export const ASSIGNMENT_RECORD_STATUS_LABEL: Record<AssignmentRecordStatus, string> = {
  EFFECTIVE: '当前有效',
  REVOKED: '已撤销',
  ALL: '全部',
}

/** 各状态筛选下拉的选项（顺序即展示顺序） */
export const USER_STATUS_OPTIONS = (['ACTIVE', 'DISABLED', 'LOCKED'] as const).map((value) => ({
  value,
  label: USER_STATUS_LABEL[value],
}))

export const EMPLOYMENT_STATUS_OPTIONS = (['ACTIVE', 'ON_LEAVE', 'LEFT'] as const).map((value) => ({
  value,
  label: EMPLOYMENT_STATUS_LABEL[value],
}))

export const ENROLLMENT_STATUS_OPTIONS = (
  ['ACTIVE', 'SUSPENDED', 'GRADUATED', 'WITHDRAWN'] as const
).map((value) => ({ value, label: ENROLLMENT_STATUS_LABEL[value] }))

export const ASSIGNMENT_RECORD_STATUS_OPTIONS = (['EFFECTIVE', 'REVOKED', 'ALL'] as const).map(
  (value) => ({ value, label: ASSIGNMENT_RECORD_STATUS_LABEL[value] }),
)
