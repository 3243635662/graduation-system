/** 用户角色摘要（仅返回调用者可见的组织范围） */
export interface UserRoleSummary {
  id: string
  code: string
  name: string
  scopeOrgUnitId: string | null
  scopeOrgUnitName: string | null
  scopeOrgUnitType: string | null
  validFrom: string
  validUntil: string | null
  revokedAt: string | null
  revocationReason: 'MANUAL' | 'QUALIFICATION_LOST' | null
  /** 后端统一计算：未撤销 + 已生效 + 未过期 + 角色启用 + 组织路径有效 + 资格有效 */
  isEffective: boolean
}

export interface UserStudentProfileSummary {
  id: string
  studentNo: string
  name: string
  classId: string
  className: string
  enrollmentStatus: string
}

export interface UserTeacherProfileSummary {
  id: string
  teacherNo: string
  departmentId: string
  departmentName: string
  employmentStatus: string
}

/** 用户列表/详情项（不包含任何认证敏感字段） */
export interface UserListItem {
  id: string
  displayName: string
  email: string
  status: 'ACTIVE' | 'DISABLED' | 'LOCKED'
  lastLoginAt: string | null
  createdAt: string
  roles: UserRoleSummary[]
  studentProfile: UserStudentProfileSummary | null
  teacherProfile: UserTeacherProfileSummary | null
}
