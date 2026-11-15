import { RoleCode } from '@graduation/shared'

import type { OrganizationType } from '../../../../generated/prisma/client.js'

/**
 * 角色 → 允许绑定的组织类型
 *
 * null 表示该角色不绑定组织节点，其数据范围由业务关系（指导/本人）决定。
 */
export const ROLE_SCOPE_TYPE: Readonly<Record<RoleCode, OrganizationType | null>> = {
  PLATFORM_SUPER_ADMIN: null,
  SCHOOL_ADMIN: 'SCHOOL',
  DEPARTMENT_ADMIN: 'DEPARTMENT',
  MAJOR_ADMIN: 'MAJOR',
  CLASS_COORDINATOR: 'CLASS',
  TEACHER: null,
  STUDENT: null,
}

/**
 * 角色分配矩阵：每个角色可以分配哪些角色
 *
 * 与规范第八节一致：
 * - 平台超管：全部预置角色（受严格运维授权约束）
 * - 学校管理员：院系/专业/协管员/教师
 * - 院系管理员：专业/协管员（教师需学校级授权，见 requiresSchoolLevel）
 * - 专业管理员：协管员
 * - 协管员/教师/学生：无
 */
export const ASSIGNABLE_ROLES: Readonly<Record<RoleCode, readonly RoleCode[]>> = {
  PLATFORM_SUPER_ADMIN: [
    RoleCode.PLATFORM_SUPER_ADMIN,
    RoleCode.SCHOOL_ADMIN,
    RoleCode.DEPARTMENT_ADMIN,
    RoleCode.MAJOR_ADMIN,
    RoleCode.CLASS_COORDINATOR,
    RoleCode.TEACHER,
    RoleCode.STUDENT,
  ],
  SCHOOL_ADMIN: [
    RoleCode.DEPARTMENT_ADMIN,
    RoleCode.MAJOR_ADMIN,
    RoleCode.CLASS_COORDINATOR,
    RoleCode.TEACHER,
  ],
  DEPARTMENT_ADMIN: [RoleCode.MAJOR_ADMIN, RoleCode.CLASS_COORDINATOR, RoleCode.TEACHER],
  MAJOR_ADMIN: [RoleCode.CLASS_COORDINATOR],
  CLASS_COORDINATOR: [],
  TEACHER: [],
  STUDENT: [],
}

const ROLE_CODES = Object.values(RoleCode)

export function isRoleCode(value: string): value is RoleCode {
  return (ROLE_CODES as string[]).includes(value)
}

/** 调用者可以分配的角色集合（多角色取并集） */
export function assignableRolesFor(actorRoleCodes: readonly string[]): RoleCode[] {
  const result = new Set<RoleCode>()

  for (const code of actorRoleCodes) {
    if (!isRoleCode(code)) continue

    for (const target of ASSIGNABLE_ROLES[code]) result.add(target)
  }

  return [...result]
}

export function canAssignRole(actorRoleCodes: readonly string[], target: RoleCode): boolean {
  return assignableRolesFor(actorRoleCodes).includes(target)
}

/**
 * 是否需要学校级授权
 *
 * 不绑定组织节点的角色（平台超管/教师/学生）一旦分配即对全校生效，
 * 无法用院系/专业的子树证明「该用户属于我的范围」，
 * 因此只有 GLOBAL 或 SCHOOL 范围的调用者可以分配。
 */
export function requiresSchoolLevel(target: RoleCode): boolean {
  return ROLE_SCOPE_TYPE[target] === null
}
