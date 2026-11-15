import {
  DEFAULT_MENU_TREE,
  DataScope,
  LEGACY_SUPER_ADMIN_ROLE_CODE,
  PRESET_PERMISSIONS,
  PRESET_ROLES,
  ROLE_MENU_CODES,
  ROLE_PERMISSION_CODES,
  RoleCode,
  type MenuTreeNode,
} from '@graduation/shared'
import { describe, expect, it } from 'vitest'

function collectPageCodes(nodes: MenuTreeNode[]): Set<string> {
  const codes = new Set<string>()

  const walk = (list: MenuTreeNode[]) => {
    for (const node of list) {
      if (node.type === 'PAGE') codes.add(node.code)
      if (node.children?.length) walk(node.children)
    }
  }

  walk(nodes)

  return codes
}

const PAGE_CODES = collectPageCodes(DEFAULT_MENU_TREE)
const ROLE_CODES = PRESET_ROLES.map((role) => role.code)

describe('预置角色定义', () => {
  it('恰好七个互不相同的预置角色，且不含旧 SUPER_ADMIN', () => {
    expect(PRESET_ROLES).toHaveLength(7)
    expect(new Set(ROLE_CODES).size).toBe(7)
    expect(ROLE_CODES).not.toContain(LEGACY_SUPER_ADMIN_ROLE_CODE)
  })

  it('角色与数据范围的对应关系符合规范', () => {
    const scopeByRole = Object.fromEntries(PRESET_ROLES.map((role) => [role.code, role.dataScope]))

    expect(scopeByRole).toEqual({
      PLATFORM_SUPER_ADMIN: DataScope.GLOBAL,
      SCHOOL_ADMIN: DataScope.SCHOOL,
      DEPARTMENT_ADMIN: DataScope.DEPARTMENT,
      MAJOR_ADMIN: DataScope.MAJOR,
      CLASS_COORDINATOR: DataScope.CLASS,
      TEACHER: DataScope.ASSIGNED,
      STUDENT: DataScope.SELF,
    })
  })
})

describe('角色菜单矩阵', () => {
  it('覆盖全部预置角色，且页面编码真实存在', () => {
    expect(Object.keys(ROLE_MENU_CODES).toSorted()).toEqual([...ROLE_CODES].toSorted())

    for (const roleCode of ROLE_CODES) {
      for (const menuCode of ROLE_MENU_CODES[roleCode]) {
        expect(PAGE_CODES.has(menuCode), `${roleCode} 引用了不存在的页面 ${menuCode}`).toBe(true)
      }
    }
  })

  it('学生个人业务页面只分配给 STUDENT', () => {
    const studentOnly = ['MY_TOPIC', 'MY_PROJECT', 'THESIS_SUBMISSION']

    for (const roleCode of ROLE_CODES) {
      if (roleCode === RoleCode.STUDENT) {
        for (const code of studentOnly) {
          expect(ROLE_MENU_CODES[roleCode]).toContain(code)
        }

        continue
      }

      for (const code of studentOnly) {
        expect(ROLE_MENU_CODES[roleCode]).not.toContain(code)
      }
    }
  })

  it('指导页面只分配给 TEACHER，审核页面不分配给 STUDENT', () => {
    for (const roleCode of ROLE_CODES) {
      expect(ROLE_MENU_CODES[roleCode].includes('GUIDANCE_STUDENTS')).toBe(
        roleCode === RoleCode.TEACHER,
      )

      if (roleCode === RoleCode.STUDENT) {
        expect(ROLE_MENU_CODES[roleCode]).not.toContain('TOPIC_REVIEW')
        expect(ROLE_MENU_CODES[roleCode]).not.toContain('THESIS_REVIEW')
        expect(ROLE_MENU_CODES[roleCode]).not.toContain('PROCESS_REVIEW')
      }
    }
  })

  it('班级协管员没有全局管理入口', () => {
    const coordinatorMenus = ROLE_MENU_CODES[RoleCode.CLASS_COORDINATOR]

    for (const forbidden of [
      'USER_MANAGEMENT',
      'ROLE_MANAGEMENT',
      'MENU_MANAGEMENT',
      'DEPARTMENT_MANAGEMENT',
      'MAJOR_MANAGEMENT',
    ]) {
      expect(coordinatorMenus).not.toContain(forbidden)
    }
  })

  it('平台超管只保留技术维护入口，不获得学生个人业务页面', () => {
    expect(ROLE_MENU_CODES[RoleCode.PLATFORM_SUPER_ADMIN]).toEqual([
      'DASHBOARD',
      'AI_ASSISTANT',
      'ROLE_MANAGEMENT',
      'MENU_MANAGEMENT',
    ])
  })
})

describe('角色权限矩阵', () => {
  it('只引用已登记的权限编码', () => {
    const known = new Set(PRESET_PERMISSIONS.map((permission) => permission.code))

    for (const roleCode of ROLE_CODES) {
      for (const permissionCode of ROLE_PERMISSION_CODES[roleCode]) {
        expect(known.has(permissionCode), `${roleCode} 引用了未登记的权限 ${permissionCode}`).toBe(
          true,
        )
      }
    }
  })

  it('权限编码全局唯一且保持 resource:action 结构', () => {
    const codes = PRESET_PERMISSIONS.map((permission) => permission.code)

    expect(new Set(codes).size).toBe(codes.length)

    for (const code of codes) {
      // resource:action，允许 resource:subresource:action 等更多层级
      expect(code).toMatch(/^[a-z-]+(:[a-z-]+)+$/)
    }
  })

  it('学生、教师、协管员没有管理类权限，学校管理员拥有组织与分配权限', () => {
    expect(ROLE_PERMISSION_CODES[RoleCode.STUDENT]).toEqual([])
    expect(ROLE_PERMISSION_CODES[RoleCode.TEACHER]).toEqual([])
    expect(ROLE_PERMISSION_CODES[RoleCode.CLASS_COORDINATOR]).toEqual([])

    const schoolAdmin = ROLE_PERMISSION_CODES[RoleCode.SCHOOL_ADMIN]

    expect(schoolAdmin).toContain('organization:unit:create')
    expect(schoolAdmin).toContain('rbac:role-assignment:assign')
    expect(schoolAdmin).toContain('rbac:role-assignment:revoke')
  })
})
