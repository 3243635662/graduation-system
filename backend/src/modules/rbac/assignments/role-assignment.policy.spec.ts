import { PRESET_ROLES, RoleCode } from '@graduation/shared'
import { describe, expect, it } from 'vitest'

import {
  ASSIGNABLE_ROLES,
  ROLE_SCOPE_TYPE,
  assignableRolesFor,
  canAssignRole,
  requiresSchoolLevel,
} from './role-assignment.policy.js'

describe('角色分配矩阵', () => {
  it('矩阵覆盖全部预置角色', () => {
    expect(Object.keys(ASSIGNABLE_ROLES).toSorted()).toEqual(
      PRESET_ROLES.map((role) => role.code).toSorted(),
    )
  })

  it('学校管理员不能分配平台超管与学校管理员（防止同级/越级提权）', () => {
    expect(canAssignRole([RoleCode.SCHOOL_ADMIN], RoleCode.PLATFORM_SUPER_ADMIN)).toBe(false)
    expect(canAssignRole([RoleCode.SCHOOL_ADMIN], RoleCode.SCHOOL_ADMIN)).toBe(false)
    expect(canAssignRole([RoleCode.SCHOOL_ADMIN], RoleCode.DEPARTMENT_ADMIN)).toBe(true)
  })

  it('院系管理员不能分配学校管理员或院系管理员', () => {
    expect(canAssignRole([RoleCode.DEPARTMENT_ADMIN], RoleCode.SCHOOL_ADMIN)).toBe(false)
    expect(canAssignRole([RoleCode.DEPARTMENT_ADMIN], RoleCode.DEPARTMENT_ADMIN)).toBe(false)
    expect(canAssignRole([RoleCode.DEPARTMENT_ADMIN], RoleCode.MAJOR_ADMIN)).toBe(true)
    expect(canAssignRole([RoleCode.DEPARTMENT_ADMIN], RoleCode.CLASS_COORDINATOR)).toBe(true)
  })

  it('专业管理员只能分配班级协管员', () => {
    expect(assignableRolesFor([RoleCode.MAJOR_ADMIN])).toEqual([RoleCode.CLASS_COORDINATOR])
  })

  it('协管员、教师、学生不能分配任何角色', () => {
    for (const code of [RoleCode.CLASS_COORDINATOR, RoleCode.TEACHER, RoleCode.STUDENT]) {
      expect(assignableRolesFor([code])).toEqual([])
    }
  })

  it('多角色取并集，不会因为拥有一个角色而继承其他角色的分配能力', () => {
    expect(assignableRolesFor([RoleCode.TEACHER, RoleCode.MAJOR_ADMIN])).toEqual([
      RoleCode.CLASS_COORDINATOR,
    ])
  })

  it('平台超管可覆盖全部预置角色', () => {
    expect(assignableRolesFor([RoleCode.PLATFORM_SUPER_ADMIN]).toSorted()).toEqual(
      PRESET_ROLES.map((role) => role.code).toSorted(),
    )
  })
})

describe('角色组织范围绑定', () => {
  it('SCHOOL/DEPARTMENT/MAJOR/CLASS 角色必须绑定对应类型组织', () => {
    expect(ROLE_SCOPE_TYPE.SCHOOL_ADMIN).toBe('SCHOOL')
    expect(ROLE_SCOPE_TYPE.DEPARTMENT_ADMIN).toBe('DEPARTMENT')
    expect(ROLE_SCOPE_TYPE.MAJOR_ADMIN).toBe('MAJOR')
    expect(ROLE_SCOPE_TYPE.CLASS_COORDINATOR).toBe('CLASS')
  })

  it('平台超管、教师、学生不绑定组织节点', () => {
    expect(ROLE_SCOPE_TYPE.PLATFORM_SUPER_ADMIN).toBeNull()
    expect(ROLE_SCOPE_TYPE.TEACHER).toBeNull()
    expect(ROLE_SCOPE_TYPE.STUDENT).toBeNull()
  })

  it('不绑定组织的角色需要学校级授权（无法用子树证明归属）', () => {
    expect(requiresSchoolLevel(RoleCode.TEACHER)).toBe(true)
    expect(requiresSchoolLevel(RoleCode.STUDENT)).toBe(true)
    expect(requiresSchoolLevel(RoleCode.PLATFORM_SUPER_ADMIN)).toBe(true)
    expect(requiresSchoolLevel(RoleCode.CLASS_COORDINATOR)).toBe(false)
  })
})
