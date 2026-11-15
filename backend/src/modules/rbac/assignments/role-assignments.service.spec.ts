import { PermissionCode, RoleCode } from '@graduation/shared'
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'

import type { PrismaService } from '../../../prisma/prisma.service.js'
import type { MenuCacheInvalidatorService } from '../../menus/menu-cache-invalidator.service.js'
import type {
  OrganizationScope,
  OrganizationScopeService,
} from '../authorization/organization-scope.service.js'
import type {
  EffectiveRoleAssignment,
  PermissionService,
} from '../authorization/permission.service.js'
import type { OrganizationService } from '../organizations/organization.service.js'
import { RoleAssignmentsService } from './role-assignments.service.js'

type ScopeType = 'SCHOOL' | 'DEPARTMENT' | 'MAJOR' | 'CLASS'

interface FakeRow {
  id: string
  userId: string
  scopeOrgUnitId: string | null
  validFrom: Date
  validUntil: Date | null
  revokedAt: Date | null
  assignedById: string | null
  revokedById: string | null
  createdAt: Date
  role: { code: string; name: string; dataScope: string; status: 'ACTIVE' | 'DISABLED' }
  scopeOrgUnit: { name: string; type: string } | null
}

function effective(
  roleCode: RoleCode,
  dataScope: EffectiveRoleAssignment['dataScope'],
  scopeOrgUnitId: string | null = null,
): EffectiveRoleAssignment {
  return {
    assignmentId: `assignment-${roleCode}`,
    roleId: `role-${roleCode}`,
    roleCode,
    roleName: roleCode,
    dataScope,
    scopeOrgUnitId,
    validFrom: new Date(0),
    validUntil: null,
  }
}

function permissionsFor(
  roleCode: RoleCode,
  dataScope: EffectiveRoleAssignment['dataScope'],
  scopeOrgUnitId: string | null = null,
) {
  const assignment = [effective(roleCode, dataScope, scopeOrgUnitId)]

  return {
    [PermissionCode.ROLE_ASSIGNMENT_READ]: assignment,
    [PermissionCode.ROLE_ASSIGNMENT_ASSIGN]: assignment,
    [PermissionCode.ROLE_ASSIGNMENT_REVOKE]: assignment,
  }
}

interface HarnessOptions {
  permissions?: Partial<Record<PermissionCode, EffectiveRoleAssignment[]>>
  scope?: OrganizationScope
  allowedScopeIds?: string[]
  units?: Record<string, { id: string; type: ScopeType; status: 'ACTIVE' | 'DISABLED' }>
  users?: Record<string, { id: string; status: 'ACTIVE' | 'DISABLED'; deletedAt: Date | null }>
  roles?: Record<string, { id: string; status: 'ACTIVE' | 'DISABLED' }>
  rows?: FakeRow[]
  duplicated?: boolean
}

const CLASS_UNIT = { id: 'org-se-1', type: 'CLASS' as const, status: 'ACTIVE' as const }
const MAJOR_UNIT = { id: 'org-se', type: 'MAJOR' as const, status: 'ACTIVE' as const }
const TARGET_USER = { id: 'user-target', status: 'ACTIVE' as const, deletedAt: null }

function createHarness(options: HarnessOptions = {}) {
  const invalidated: string[] = []
  const created: FakeRow[] = []
  const rows = (options.rows ?? []).map((row) => ({ ...row }))
  const units = options.units ?? { [CLASS_UNIT.id]: CLASS_UNIT, [MAJOR_UNIT.id]: MAJOR_UNIT }
  const users = options.users ?? { [TARGET_USER.id]: TARGET_USER }
  const roles = options.roles ?? {
    [RoleCode.CLASS_COORDINATOR]: { id: 'role-CLASS_COORDINATOR', status: 'ACTIVE' as const },
    [RoleCode.TEACHER]: { id: 'role-TEACHER', status: 'ACTIVE' as const },
  }
  const allowedScopeIds = options.allowedScopeIds ?? ['org-cs', 'org-se', 'org-se-1']

  const prisma = {
    $transaction: async (callback: (tx: unknown) => unknown) => callback(prisma),
    user: {
      async findUnique({ where }: { where: { id: string } }) {
        return users[where.id] ?? null
      },
    },
    role: {
      async findUnique({ where }: { where: { code: string } }) {
        return roles[where.code] ?? null
      },
    },
    userRole: {
      async findUnique({ where }: { where: { id: string } }) {
        return rows.find((row) => row.id === where.id) ?? null
      },
      async findFirst() {
        return options.duplicated ? { id: 'duplicated' } : null
      },
      async findMany({ where }: { where: { userId: string; revokedAt?: null } }) {
        return rows.filter(
          (row) =>
            row.userId === where.userId &&
            (where.revokedAt === null ? row.revokedAt === null : true),
        )
      },
      async create({ data }: { data: Record<string, unknown> }) {
        const roleEntry = Object.entries(roles).find(([, value]) => value.id === data['roleId'])
        const roleCode = roleEntry?.[0] ?? 'UNKNOWN'
        const scopeUnitId = (data['scopeOrgUnitId'] as string | null | undefined) ?? null
        const unit = scopeUnitId ? units[scopeUnitId] : undefined

        const row: FakeRow = {
          id: 'assignment-new',
          userId: String(data['userId']),
          scopeOrgUnitId: scopeUnitId,
          validFrom: data['validFrom'] as Date,
          validUntil: (data['validUntil'] as Date | null | undefined) ?? null,
          revokedAt: null,
          assignedById: (data['assignedById'] as string | null | undefined) ?? null,
          revokedById: null,
          createdAt: new Date(),
          role: {
            code: roleCode,
            name: roleCode,
            dataScope: 'CLASS',
            status: 'ACTIVE',
          },
          scopeOrgUnit: unit ? { name: unit.id, type: unit.type } : null,
        }

        created.push(row)
        rows.push(row)

        return row
      },
      async updateMany({
        where,
        data,
      }: {
        where: { id: string; revokedAt: null }
        data: Record<string, unknown>
      }) {
        const row = rows.find((item) => item.id === where.id && item.revokedAt === null)

        if (!row) return { count: 0 }

        Object.assign(row, data)

        return { count: 1 }
      },
    },
  }

  const permissionService = {
    findPermissionAssignments: vi.fn(async (_userId: string, code: string) => {
      return options.permissions?.[code as PermissionCode] ?? []
    }),
  }

  const scopeService = {
    resolve: vi.fn(async () => options.scope ?? { kind: 'NONE' as const }),
    assertOrgUnitAccess: vi.fn(async (_userId: string, _code: string, orgUnitId: string) => {
      if (!allowedScopeIds.includes(orgUnitId)) {
        throw new ForbiddenException({ code: 40300, data: null, message: '越权' })
      }
    }),
  }

  const organizationService = {
    findById: vi.fn(async (id: string) => {
      const unit = units[id]

      if (!unit) throw new BadRequestException('组织节点不存在')

      return { ...unit, name: unit.id, code: unit.id, sortOrder: 0, parentId: null, children: [] }
    }),
  }

  const invalidator = {
    // 与真实实现一致：只有事务成功提交后才提升 generation
    commitThenInvalidate: vi.fn(async (reason: string, run: () => Promise<unknown>) => {
      const result = await run()

      invalidated.push(reason)

      return result
    }),
  }

  const coordinatorEligibility = { assertEligible: vi.fn(async () => undefined) }

  const service = new RoleAssignmentsService(
    prisma as unknown as PrismaService,
    permissionService as unknown as PermissionService,
    scopeService as unknown as OrganizationScopeService,
    organizationService as unknown as OrganizationService,
    invalidator as unknown as MenuCacheInvalidatorService,
    coordinatorEligibility as unknown as import('../../profiles/coordinator-eligibility.service.js').CoordinatorEligibilityService,
  )

  return { service, invalidated, created, rows, permissionService, scopeService }
}

const deptActorPermissions = permissionsFor(RoleCode.DEPARTMENT_ADMIN, 'DEPARTMENT', 'org-cs')
const deptScope: OrganizationScope = {
  kind: 'SUBTREE',
  orgUnitIds: ['org-cs', 'org-se', 'org-se-1'],
}

describe('RoleAssignmentsService.assign', () => {
  it('院系管理员可在本院系班级分配班级协管员，并触发菜单缓存失效', async () => {
    const harness = createHarness({ permissions: deptActorPermissions, scope: deptScope })

    const result = await harness.service.assign('actor-dept', {
      userId: TARGET_USER.id,
      roleCode: RoleCode.CLASS_COORDINATOR,
      scopeOrgUnitId: CLASS_UNIT.id,
    })

    expect(result).toMatchObject({
      roleCode: RoleCode.CLASS_COORDINATOR,
      scopeOrgUnitId: CLASS_UNIT.id,
      assignedById: 'actor-dept',
      isEffective: true,
    })
    expect(harness.invalidated).toEqual(['user-role.assign'])
  })

  it('院系管理员不能把协管员分配到其他院系的班级', async () => {
    const econClass = { id: 'org-econ-1', type: 'CLASS' as const, status: 'ACTIVE' as const }
    const harness = createHarness({
      permissions: deptActorPermissions,
      scope: deptScope,
      units: { [CLASS_UNIT.id]: CLASS_UNIT, [econClass.id]: econClass },
    })

    await expect(
      harness.service.assign('actor-dept', {
        userId: TARGET_USER.id,
        roleCode: RoleCode.CLASS_COORDINATOR,
        scopeOrgUnitId: econClass.id,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException)

    expect(harness.created).toHaveLength(0)
    expect(harness.invalidated).toEqual([])
  })

  it('专业管理员不能分配院系管理员（矩阵提权防护）', async () => {
    const harness = createHarness({
      permissions: permissionsFor(RoleCode.MAJOR_ADMIN, 'MAJOR', 'org-se'),
      scope: { kind: 'SUBTREE', orgUnitIds: ['org-se', 'org-se-1'] },
    })

    await expect(
      harness.service.assign('actor-major', {
        userId: TARGET_USER.id,
        roleCode: RoleCode.DEPARTMENT_ADMIN,
        scopeOrgUnitId: 'org-cs',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('院系管理员不能分配对全校生效的教师角色', async () => {
    const harness = createHarness({ permissions: deptActorPermissions, scope: deptScope })

    await expect(
      harness.service.assign('actor-dept', {
        userId: TARGET_USER.id,
        roleCode: RoleCode.TEACHER,
        scopeOrgUnitId: null,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('学校管理员可以分配教师角色（不绑定组织）', async () => {
    const harness = createHarness({
      permissions: permissionsFor(RoleCode.SCHOOL_ADMIN, 'SCHOOL', 'org-school'),
      scope: { kind: 'SUBTREE', orgUnitIds: ['org-school', 'org-cs', 'org-se', 'org-se-1'] },
    })

    const result = await harness.service.assign('actor-school', {
      userId: TARGET_USER.id,
      roleCode: RoleCode.TEACHER,
      scopeOrgUnitId: null,
    })

    expect(result.roleCode).toBe(RoleCode.TEACHER)
    expect(result.scopeOrgUnitId).toBeNull()
  })

  it('角色必须绑定与其类型匹配的组织节点', async () => {
    const harness = createHarness({ permissions: deptActorPermissions, scope: deptScope })

    await expect(
      harness.service.assign('actor-dept', {
        userId: TARGET_USER.id,
        roleCode: RoleCode.CLASS_COORDINATOR,
        scopeOrgUnitId: MAJOR_UNIT.id,
      }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('已停用的组织节点不能作为分配范围', async () => {
    const disabledClass = { id: 'org-se-1', type: 'CLASS' as const, status: 'DISABLED' as const }
    const harness = createHarness({
      permissions: deptActorPermissions,
      scope: deptScope,
      units: { [disabledClass.id]: disabledClass },
    })

    await expect(
      harness.service.assign('actor-dept', {
        userId: TARGET_USER.id,
        roleCode: RoleCode.CLASS_COORDINATOR,
        scopeOrgUnitId: disabledClass.id,
      }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('重复的有效分配返回 409', async () => {
    const harness = createHarness({
      permissions: deptActorPermissions,
      scope: deptScope,
      duplicated: true,
    })

    await expect(
      harness.service.assign('actor-dept', {
        userId: TARGET_USER.id,
        roleCode: RoleCode.CLASS_COORDINATOR,
        scopeOrgUnitId: CLASS_UNIT.id,
      }),
    ).rejects.toBeInstanceOf(ConflictException)
  })

  it('已禁用用户不能被分配角色', async () => {
    const harness = createHarness({
      permissions: deptActorPermissions,
      scope: deptScope,
      users: { [TARGET_USER.id]: { ...TARGET_USER, status: 'DISABLED' } },
    })

    await expect(
      harness.service.assign('actor-dept', {
        userId: TARGET_USER.id,
        roleCode: RoleCode.CLASS_COORDINATOR,
        scopeOrgUnitId: CLASS_UNIT.id,
      }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('有效期早于当前时间会被拒绝', async () => {
    const harness = createHarness({ permissions: deptActorPermissions, scope: deptScope })

    await expect(
      harness.service.assign('actor-dept', {
        userId: TARGET_USER.id,
        roleCode: RoleCode.CLASS_COORDINATOR,
        scopeOrgUnitId: CLASS_UNIT.id,
        validUntil: new Date(Date.now() - 1_000).toISOString(),
      }),
    ).rejects.toBeInstanceOf(BadRequestException)
  })
})

describe('RoleAssignmentsService.revoke', () => {
  const baseRow: FakeRow = {
    id: 'assignment-1',
    userId: 'user-target',
    scopeOrgUnitId: CLASS_UNIT.id,
    validFrom: new Date(0),
    validUntil: null,
    revokedAt: null,
    assignedById: 'actor-dept',
    revokedById: null,
    createdAt: new Date(0),
    role: {
      code: RoleCode.CLASS_COORDINATOR,
      name: '班级事务协管员',
      dataScope: 'CLASS',
      status: 'ACTIVE',
    },
    scopeOrgUnit: { name: '软件工程一班', type: 'CLASS' },
  }

  it('院系管理员可撤销本院系班级的协管员分配，只写撤销字段', async () => {
    const harness = createHarness({
      permissions: deptActorPermissions,
      scope: deptScope,
      rows: [baseRow],
    })

    const result = await harness.service.revoke('actor-dept', baseRow.id)

    expect(result).toMatchObject({ id: baseRow.id, revokedById: 'actor-dept', isEffective: false })
    expect(harness.rows[0]?.revokedAt).toBeInstanceOf(Date)
    expect(harness.invalidated).toEqual(['user-role.revoke'])
  })

  it('不能撤销自己的角色分配', async () => {
    const harness = createHarness({
      permissions: deptActorPermissions,
      scope: deptScope,
      rows: [{ ...baseRow, userId: 'actor-dept' }],
    })

    await expect(harness.service.revoke('actor-dept', baseRow.id)).rejects.toBeInstanceOf(
      ForbiddenException,
    )
  })

  it('不能撤销其他院系的分配', async () => {
    const harness = createHarness({
      permissions: deptActorPermissions,
      scope: deptScope,
      rows: [{ ...baseRow, scopeOrgUnitId: 'org-econ-1' }],
    })

    await expect(harness.service.revoke('actor-dept', baseRow.id)).rejects.toBeInstanceOf(
      ForbiddenException,
    )
  })

  it('已撤销的分配再次撤销返回 409', async () => {
    const harness = createHarness({
      permissions: deptActorPermissions,
      scope: deptScope,
      rows: [{ ...baseRow, revokedAt: new Date(0) }],
    })

    await expect(harness.service.revoke('actor-dept', baseRow.id)).rejects.toBeInstanceOf(
      ConflictException,
    )
  })
})

describe('RoleAssignmentsService 查询', () => {
  it('可分配角色来自矩阵：专业管理员只能看到班级协管员', async () => {
    const harness = createHarness({
      permissions: permissionsFor(RoleCode.MAJOR_ADMIN, 'MAJOR', 'org-se'),
    })

    const items = await harness.service.listAssignableRoles('actor-major')

    expect(items.map((item) => item.code)).toEqual([RoleCode.CLASS_COORDINATOR])
    expect(items[0]).toMatchObject({ scopeType: 'CLASS', requiresSchoolLevel: false })
  })

  it('角色列表按组织范围过滤，不返回其他院系的分配', async () => {
    const row = (id: string, scopeOrgUnitId: string): FakeRow => ({
      id,
      userId: TARGET_USER.id,
      scopeOrgUnitId,
      validFrom: new Date(0),
      validUntil: null,
      revokedAt: null,
      assignedById: 'actor',
      revokedById: null,
      createdAt: new Date(0),
      role: {
        code: RoleCode.CLASS_COORDINATOR,
        name: '班级事务协管员',
        dataScope: 'CLASS',
        status: 'ACTIVE',
      },
      scopeOrgUnit: null,
    })

    const harness = createHarness({
      permissions: deptActorPermissions,
      scope: deptScope,
      rows: [row('a-in-scope', CLASS_UNIT.id), row('a-out-of-scope', 'org-econ-1')],
    })

    const items = await harness.service.listForUser('actor-dept', TARGET_USER.id)

    expect(items.map((item) => item.id)).toEqual(['a-in-scope'])
  })

  it('学校管理员可以查看全校范围的分配（含自身角色）', async () => {
    const harness = createHarness({
      permissions: permissionsFor(RoleCode.SCHOOL_ADMIN, 'SCHOOL', 'org-school'),
      scope: { kind: 'SUBTREE', orgUnitIds: ['org-school', 'org-cs'] },
      rows: [
        {
          id: 'a-school-admin',
          userId: TARGET_USER.id,
          scopeOrgUnitId: 'org-school',
          validFrom: new Date(0),
          validUntil: null,
          revokedAt: null,
          assignedById: 'actor',
          revokedById: null,
          createdAt: new Date(0),
          role: {
            code: RoleCode.SCHOOL_ADMIN,
            name: '学校管理员',
            dataScope: 'SCHOOL',
            status: 'ACTIVE',
          },
          scopeOrgUnit: { name: '示范大学', type: 'SCHOOL' },
        },
      ],
    })

    const items = await harness.service.listForUser('actor-school', TARGET_USER.id)

    expect(items.map((item) => item.roleCode)).toEqual([RoleCode.SCHOOL_ADMIN])
  })

  it('院系管理员看不到不绑定组织的教师分配', async () => {
    const harness = createHarness({
      permissions: deptActorPermissions,
      scope: deptScope,
      rows: [
        {
          id: 'a-teacher',
          userId: TARGET_USER.id,
          scopeOrgUnitId: null,
          validFrom: new Date(0),
          validUntil: null,
          revokedAt: null,
          assignedById: 'actor',
          revokedById: null,
          createdAt: new Date(0),
          role: {
            code: RoleCode.TEACHER,
            name: '教师',
            dataScope: 'ASSIGNED',
            status: 'ACTIVE',
          },
          scopeOrgUnit: null,
        },
      ],
    })

    const items = await harness.service.listForUser('actor-dept', TARGET_USER.id)

    expect(items).toEqual([])
  })
})
