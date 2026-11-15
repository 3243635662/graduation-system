import { ForbiddenException } from '@nestjs/common'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PrismaService } from '../../prisma/prisma.service.js'
import type { CoordinatorEligibilityService } from '../profiles/coordinator-eligibility.service.js'
import type { OrganizationScopeService } from '../rbac/authorization/organization-scope.service.js'
import type { PermissionService } from '../rbac/authorization/permission.service.js'
import type { OrganizationService } from '../rbac/organizations/organization.service.js'
import { UsersService } from './users.service.js'

const NOW = new Date()

function roleRow(overrides: Record<string, unknown>) {
  return {
    id: 'assignment-1',
    userId: 'user-1',
    scopeOrgUnitId: 'class-1',
    validFrom: new Date(0),
    validUntil: null,
    revokedAt: null,
    revocationReason: null,
    role: {
      code: 'CLASS_COORDINATOR',
      name: '班级事务协管员',
      dataScope: 'CLASS',
      status: 'ACTIVE',
    },
    scopeOrgUnit: { name: '软件工程一班', type: 'CLASS' },
    ...overrides,
  }
}

function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    displayName: '张三',
    email: 'zhangsan@example.test',
    status: 'ACTIVE',
    lastLoginAt: null,
    createdAt: NOW,
    deletedAt: null,
    studentProfile: {
      id: 'student-1',
      studentNo: '2024001',
      name: '张三',
      classId: 'class-1',
      enrollmentStatus: 'ACTIVE',
      class: { id: 'class-1', name: '软件工程一班' },
    },
    teacherProfile: {
      id: 'teacher-1',
      teacherNo: 'T001',
      departmentId: 'dept-other',
      employmentStatus: 'ACTIVE',
      department: { id: 'dept-other', name: '经济管理学院' },
    },
    ...overrides,
  }
}

function createHarness(
  options: {
    users?: unknown[]
    roleRows?: unknown[]
    qualifiedKeys?: string[]
    userScope?: unknown
    foundUser?: unknown
  } = {},
) {
  const whereCalls: unknown[] = []

  const prisma = {
    user: {
      findMany: vi.fn(async ({ where }: { where: unknown }) => {
        whereCalls.push(where)

        return options.users ?? [userRow()]
      }),
      count: vi.fn(async () => (options.users ?? [userRow()]).length),
      findFirst: vi.fn(async () => options.foundUser ?? null),
    },
    userRole: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        if (where['role']) {
          return [{ userId: 'user-1', scopeOrgUnitId: 'class-1' }]
        }

        return options.roleRows ?? [roleRow({})]
      }),
    },
  }

  const scopeService = {
    resolve: vi.fn(async (_actor: string, code: string) => {
      if (code === 'user:read') {
        return options.userScope ?? { kind: 'SUBTREE', orgUnitIds: ['major-1', 'class-1'] }
      }

      if (code === 'student:profile:read') {
        return { kind: 'SUBTREE', orgUnitIds: ['class-1'] }
      }

      if (code === 'teacher:profile:read') {
        return { kind: 'NONE' }
      }

      if (code === 'rbac:role-assignment:read') {
        return { kind: 'SUBTREE', orgUnitIds: ['major-1', 'class-1'] }
      }

      return { kind: 'NONE' }
    }),
    assertOrgUnitAccess: vi.fn(async () => undefined),
  }

  const permissionService = {
    findPermissionAssignments: vi.fn(async () => [
      { assignmentId: 'a', roleCode: 'MAJOR_ADMIN', dataScope: 'MAJOR', scopeOrgUnitId: 'major-1' },
    ]),
  }

  const organizationService = {
    getSubtreeIds: vi.fn(async (id: string) => [id]),
  }

  const eligibility = {
    filterQualifiedUserIds: vi.fn(async () => new Set(options.qualifiedKeys ?? ['user-1:class-1'])),
  }

  const service = new UsersService(
    prisma as unknown as PrismaService,
    scopeService as unknown as OrganizationScopeService,
    permissionService as unknown as PermissionService,
    organizationService as unknown as OrganizationService,
    eligibility as unknown as CoordinatorEligibilityService,
  )

  return { service, whereCalls, prisma, scopeService, eligibility }
}

describe('UsersService.list', () => {
  beforeEach(() => vi.clearAllMocks())

  it('账号查询默认只包含 ACTIVE、未删除用户', async () => {
    const harness = createHarness()

    await harness.service.list('actor-1', { page: 1, pageSize: 10 })

    expect(JSON.stringify(harness.whereCalls[0])).toContain('"deletedAt":null')
    expect(JSON.stringify(harness.whereCalls[0])).toContain('"status":"ACTIVE"')
  })

  it('MAJOR_ADMIN 只看到范围内学生档案，看不到范围外教师档案与角色', async () => {
    const harness = createHarness({
      roleRows: [
        roleRow({}),
        roleRow({
          id: 'assignment-other',
          scopeOrgUnitId: 'dept-other',
          role: {
            code: 'DEPARTMENT_ADMIN',
            name: '院系管理员',
            dataScope: 'DEPARTMENT',
            status: 'ACTIVE',
          },
          scopeOrgUnit: { name: '经济管理学院', type: 'DEPARTMENT' },
        }),
      ],
    })

    const result = await harness.service.list('actor-major', { page: 1, pageSize: 10 })
    const item = result.list[0]!

    expect(item.studentProfile?.studentNo).toBe('2024001')
    expect(item.teacherProfile).toBeNull()
    expect(item.roles.map((role) => role.code)).toEqual(['CLASS_COORDINATOR'])
  })

  it('协管员角色按「用户+班级」资格判定，不会整用户误判为有效', async () => {
    const harness = createHarness({ qualifiedKeys: [] })

    const result = await harness.service.list('actor-major', { page: 1, pageSize: 10 })

    expect(result.list[0]?.roles[0]?.isEffective).toBe(false)
  })

  it('已撤销的角色保留历史但 isEffective=false', async () => {
    const harness = createHarness({
      roleRows: [roleRow({ revokedAt: NOW, revocationReason: 'MANUAL' })],
    })

    const result = await harness.service.list('actor-major', { page: 1, pageSize: 10 })

    expect(result.list[0]?.roles[0]?.revokedAt).toBeInstanceOf(Date)
    expect(result.list[0]?.roles[0]?.isEffective).toBe(false)
  })

  it('roleCode=CLASS_COORDINATOR 只匹配仍具备资格的账号', async () => {
    const harness = createHarness({ qualifiedKeys: [] })

    await harness.service.list('actor-major', {
      page: 1,
      pageSize: 10,
      roleCode: 'CLASS_COORDINATOR',
    })

    expect(JSON.stringify(harness.whereCalls[0])).toContain('"id":{"in":[]}')
  })

  it('orgUnitId 越权直接 403，不执行查询', async () => {
    const harness = createHarness()
    const assertSpy = harness.scopeService.assertOrgUnitAccess as unknown as ReturnType<
      typeof vi.fn
    >

    assertSpy.mockRejectedValueOnce(new ForbiddenException())

    await expect(
      harness.service.list('actor-major', {
        page: 1,
        pageSize: 10,
        orgUnitId: '00000000-0000-4000-8000-000000000099',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException)

    expect(harness.prisma.user.findMany).not.toHaveBeenCalled()
  })

  it('没有可用组织范围时直接 403', async () => {
    const harness = createHarness({ userScope: { kind: 'NONE' } })

    await expect(
      harness.service.list('actor-unknown', { page: 1, pageSize: 10 }),
    ).rejects.toBeInstanceOf(ForbiddenException)

    expect(harness.prisma.user.findMany).not.toHaveBeenCalled()
  })

  it('用户查询不包含 passwordHash 等认证字段', async () => {
    const harness = createHarness()

    await harness.service.list('actor-major', { page: 1, pageSize: 10 })

    const select = (harness.prisma.user.findMany as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0].select

    expect(select).not.toHaveProperty('passwordHash')
    expect(select).not.toHaveProperty('sessions')
  })
})

describe('UsersService.findOne', () => {
  it('详情不在范围内时返回 403', async () => {
    const harness = createHarness({ foundUser: null })

    await expect(
      harness.service.findOne('actor-major', '00000000-0000-4000-8000-000000000099'),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('详情使用与列表相同的档案过滤规则', async () => {
    const harness = createHarness({ foundUser: userRow() })

    const item = await harness.service.findOne('actor-major', 'user-1')

    expect(item.studentProfile?.classId).toBe('class-1')
    expect(item.teacherProfile).toBeNull()
  })
})
