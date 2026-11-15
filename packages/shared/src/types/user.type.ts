/** 用户角色摘要（仅返回调用者可见的组织范围） */
export interface UserRoleSummary {
  id: string
  code: string
  name: string
  scopeOrgUnitId: string | null
  scopeKey: string
  scopeOrgUnitName: string | null
  scopeOrgUnitType: string | null
  validFrom: string
  validUntil: string | null
  /** 后端统一计算：已生效 + 未过期 + 角色启用 + 组织路径有效 + 资格有效 */
  isEffective: boolean
}

export interface UserStudentProfileSummary {
  id: string
  studentNo: string
  /** 姓名统一取 User.realName，档案不再单独保存 */
  name: string
  /** 空表示尚未分班 */
  classId: string | null
  className: string | null
  enrollmentStatus: string
}

export interface UserTeacherProfileSummary {
  id: string
  teacherNo: string
  realName: string
  organizationId: string
  organizationName: string
  organizationType: string
  status: string
}

/** 用户列表/详情项（不包含任何认证敏感字段） */
export interface UserListItem {
  id: string
  realName: string
  email: string
  phone: string | null
  status: 'ACTIVE' | 'DISABLED' | 'LOCKED'
  lastLoginAt: string | null
  createdAt: string
  roles: UserRoleSummary[]
  studentProfile: UserStudentProfileSummary | null
  teacherProfile: UserTeacherProfileSummary | null
}
