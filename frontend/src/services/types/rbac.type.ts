import type { PaginationQuery, UserStatus } from '@graduation/shared'

/**
 * RBAC / 人员档案相关的前端类型
 *
 * 只描述后端真实返回的结构：
 * - 通用分页类型（PaginationQuery / PaginatedData）与 AuthUser 来自 @graduation/shared；
 * - 这里仅补充各管理接口的列表项、详情与请求体。
 */

/** 组织节点类型，与 Prisma OrganizationType 一致 */
export type OrganizationType = 'SCHOOL' | 'DEPARTMENT' | 'MAJOR' | 'CLASS'

/** 组织节点状态 */
export type OrganizationStatus = 'ACTIVE' | 'DISABLED'

/** 工作人员在职状态 */
export type EmploymentStatus = 'ACTIVE' | 'ON_LEAVE' | 'LEFT'

/** 学籍状态 */
export type EnrollmentStatus = 'ACTIVE' | 'SUSPENDED' | 'GRADUATED' | 'WITHDRAWN'

/** 授权记录查询状态（当前有效 / 已撤销 / 全部） */
export type AssignmentRecordStatus = 'EFFECTIVE' | 'REVOKED' | 'ALL'

/** 组织树节点：GET /organizations/tree 与 GET /organizations/:id */
export interface OrganizationNode {
  id: string
  name: string
  code: string
  type: OrganizationType
  status: OrganizationStatus
  sortOrder: number
  parentId: string | null
  children: OrganizationNode[]
}

export interface CreateOrganizationInput {
  name: string
  code: string
  type: OrganizationType
  parentId?: string | null
  sortOrder?: number
}

export interface UpdateOrganizationInput {
  name?: string
  sortOrder?: number
  status?: OrganizationStatus
}

// ——————————————————————————————————————————————
// 用户账号
// ——————————————————————————————————————————————

/** 用户账号下的角色摘要（已按调用者可见范围过滤） */
export interface UserRoleSummary {
  id: string
  code: string
  name: string
  scopeOrgUnitId: string | null
  scopeOrgUnitName: string | null
  scopeOrgUnitType: OrganizationType | null
  validFrom: string
  validUntil: string | null
  isEffective: boolean
}

export interface UserStudentProfileSummary {
  id: string
  studentNo: string
  /** 姓名统一取 User.realName */
  name: string
  classId: string | null
  className: string | null
  enrollmentStatus: EnrollmentStatus
}

export interface UserTeacherProfileSummary {
  id: string
  teacherNo: string
  realName: string
  organizationId: string
  organizationName: string
  organizationType: OrganizationType
  status: EmploymentStatus
}

/** GET /users 列表项与 GET /users/:id 详情 */
export interface UserAccountItem {
  id: string
  realName: string
  email: string
  /** 后端当前列表未返回手机号，保留可选避免误判为空字符串 */
  phone?: string | null
  status: UserStatus
  lastLoginAt: string | null
  createdAt: string
  roles: UserRoleSummary[]
  studentProfile: UserStudentProfileSummary | null
  teacherProfile: UserTeacherProfileSummary | null
}

export interface UserListQuery extends PaginationQuery {
  /** 姓名或邮箱模糊搜索 */
  keyword?: string
  status?: UserStatus
  roleCode?: string
  orgUnitId?: string
}

// ——————————————————————————————————————————————
// 学生档案
// ——————————————————————————————————————————————

/** GET /student-profiles 列表项 */
export interface StudentProfileItem {
  id: string
  studentNo: string
  userId: string
  realName: string
  email: string
  accountStatus: UserStatus
  classId: string | null
  className: string | null
  majorName: string | null
  enrollmentYear: number | null
  enrollmentStatus: EnrollmentStatus
  updatedAt: string
}

/** 学生分班 / 转班历史 */
export interface StudentClassTransferItem {
  id: string
  fromClassId: string | null
  fromClassName: string | null
  toClassId: string
  toClassName: string
  reason: string
  transferredAt: string
  transferredBy: { id: string; realName: string } | null
}

/** GET /student-profiles/:id 详情 */
export interface StudentProfileDetail {
  id: string
  studentNo: string
  realName: string
  classId: string | null
  className: string | null
  majorName: string | null
  departmentName: string | null
  enrollmentYear: number | null
  enrollmentStatus: EnrollmentStatus
  createdAt: string
  updatedAt: string
  updatedBy: { id: string; realName: string } | null
  account: {
    id: string
    realName: string
    email: string
    phone: string | null
    avatarUrl: string | null
    status: UserStatus
  }
  transfers: StudentClassTransferItem[]
}

export interface StudentListQuery extends PaginationQuery {
  keyword?: string
  studentNo?: string
  realName?: string
  classId?: string
  orgUnitId?: string
  enrollmentStatus?: EnrollmentStatus
  /** 只看尚未分班的学生 */
  unassignedOnly?: boolean
}

export interface CreateStudentProfileInput {
  userId: string
  studentNo: string
  classId?: string | null
  enrollmentYear?: number | null
}

export interface UpdateStudentProfileInput {
  studentNo?: string
  enrollmentYear?: number | null
}

export interface TransferStudentInput {
  targetClassId: string
  reason: string
}

// ——————————————————————————————————————————————
// 工作人员档案
// ——————————————————————————————————————————————

/** 教师档案记录（挂在工作人员档案下） */
export interface TeacherProfileRecord {
  id: string
  teacherNo: string
  title: string | null
  professionalInfo: string | null
  status: EmploymentStatus
  createdAt: string
  updatedAt: string
}

/** GET /personnel-profiles 列表项 */
export interface PersonnelProfileItem {
  id: string
  userId: string
  employeeNo: string | null
  positionName: string | null
  status: EmploymentStatus
  organizationId: string
  organizationName: string
  organizationType: OrganizationType
  realName: string
  email: string
  phone: string | null
  accountStatus: UserStatus
  isTeacher: boolean
  teacherNo: string | null
  title: string | null
  updatedAt: string
}

/** GET /personnel-profiles/:id 详情 */
export interface PersonnelProfileDetail {
  id: string
  userId: string
  employeeNo: string | null
  positionName: string | null
  status: EmploymentStatus
  createdAt: string
  updatedAt: string
  account: {
    id: string
    realName: string
    email: string
    phone: string | null
    avatarUrl: string | null
    status: UserStatus
  }
  organization: { id: string; name: string; type: OrganizationType }
  teacherProfile: TeacherProfileRecord | null
  createdBy: { id: string; realName: string } | null
  updatedBy: { id: string; realName: string } | null
}

export interface PersonnelListQuery extends PaginationQuery {
  keyword?: string
  employeeNo?: string
  realName?: string
  organizationId?: string
  status?: EmploymentStatus
  /** 只看同时具备教师身份的工作人员 */
  teacherOnly?: boolean
}

export interface CreatePersonnelProfileInput {
  userId: string
  employeeNo?: string
  primaryOrganizationUnitId: string
  positionName?: string
}

export interface UpdatePersonnelProfileInput {
  employeeNo?: string | null
  positionName?: string | null
  primaryOrganizationUnitId?: string
}

// ——————————————————————————————————————————————
// 教师档案
// ——————————————————————————————————————————————

/** GET /teacher-profiles 列表项 */
export interface TeacherProfileItem {
  id: string
  teacherNo: string
  title: string | null
  status: EmploymentStatus
  personnelProfileId: string
  employeeNo: string | null
  positionName: string | null
  organizationId: string
  organizationName: string
  organizationType: OrganizationType
  userId: string
  realName: string
  email: string
  phone: string | null
  accountStatus: UserStatus
  updatedAt: string
}

export interface TeacherClassDutySummary {
  id: string
  classId: string
  className: string
  dutyType: string
  validFrom: string
  validUntil: string | null
  revokedAt: string | null
  isEffective: boolean
}

/** GET /teacher-profiles/:id 详情 */
export interface TeacherProfileDetail {
  id: string
  teacherNo: string
  title: string | null
  professionalInfo: string | null
  status: EmploymentStatus
  createdAt: string
  updatedAt: string
  createdBy: { id: string; realName: string } | null
  updatedBy: { id: string; realName: string } | null
  personnelProfile: {
    id: string
    employeeNo: string | null
    positionName: string | null
    status: EmploymentStatus
    primaryOrganizationUnitId: string
    primaryOrganization: { id: string; name: string; type: OrganizationType }
    user: {
      id: string
      realName: string
      email: string
      phone: string | null
      avatarUrl: string | null
      status: UserStatus
    }
  }
  classDuties: TeacherClassDutySummary[]
}

export interface TeacherListQuery extends PaginationQuery {
  keyword?: string
  teacherNo?: string
  realName?: string
  organizationId?: string
  employmentStatus?: EmploymentStatus
}

export interface CreateTeacherProfileInput {
  personnelProfileId: string
  teacherNo: string
  title?: string | null
  professionalInfo?: string | null
}

export interface UpdateTeacherProfileInput {
  teacherNo?: string
  title?: string | null
  professionalInfo?: string | null
}

// ——————————————————————————————————————————————
// 角色与授权
// ——————————————————————————————————————————————

/** GET /roles 角色模板 */
export interface RoleTemplate {
  id: string
  code: string
  name: string
  description: string | null
  dataScope: string
  isSystem: boolean
  status: 'ACTIVE' | 'DISABLED'
  createdAt: string
  updatedAt: string
}

/** GET /role-assignments/assignable-roles 当前用户可分配的角色 */
export interface AssignableRole {
  code: string
  name: string
  dataScope: string
  scopeType: OrganizationType | null
  requiresSchoolLevel: boolean
}

/** 当前授权数组元素 */
export interface RoleAssignmentItem {
  id: string
  userId: string
  roleCode: string
  roleName: string
  scopeOrgUnitId: string | null
  scopeKey: string
  scopeOrgUnitName: string | null
  scopeOrgUnitType: OrganizationType | null
  validFrom: string
  validUntil: string | null
  isEffective: boolean
}

/** 撤销历史元素 */
export interface RoleAssignmentHistoryItem {
  id: string
  userRoleId: string
  userId: string
  roleId: string
  roleCode: string
  roleName: string
  scopeOrgUnitId: string | null
  scopeKey: string
  scopeOrgUnitName: string | null
  scopeOrgUnitType: OrganizationType | null
  validFrom: string
  validUntil: string | null
  revokedAt: string
  revokedById: string | null
  revokedByName: string | null
  revocationReason: 'MANUAL' | 'QUALIFICATION_LOST'
  note: string | null
}

export interface AssignRoleInput {
  userId: string
  roleCode: string
  scopeOrgUnitId?: string | null
  /** ISO 8601 字符串；缺省为长期有效 */
  validUntil?: string | null
}
