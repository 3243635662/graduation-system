import { describe, expect, it } from 'vitest'

import type { PrismaService } from '../../../prisma/prisma.service.js'
import { PermissionService } from './permission.service.js'

type FakeRole = {
  code: string
  name: string
  dataScope: 'GLOBAL' | 'SCHOOL' | 'DEPARTMENT' | 'MAJOR' | 'CLASS' | 'ASSIGNED' | 'SELF'
  status: 'ACTIVE' | 'DISABLED'
}

interface FakeAssignment {
  id: string
  userId: string
  roleId: string
  scopeOrgUnitId: string | null
  validFrom: Date
  validUntil: Date | null
  revokedAt: Date | null
  createdAt: Date
  role: FakeRole
}

interface FakeGrant {
  roleId: string
  permissionCode: string
}

const NOW = new Date('2026-11-13T00:00:00.000Z')
const PAST = new Date('2026-01-01T00:00:00.000Z')
const FUTURE = new Date('2027-01-01T00:00:00.000Z')

function assignment(
  partial: Partial<FakeAssignment> & Pick<FakeAssignment, 'id' | 'roleId'>,
): FakeAssignment {
  return {
    userId: 'user-1',
    scopeOrgUnitId: null,
    validFrom: PAST,
    validUntil: null,
    revokedAt: null,
    createdAt: PAST,
    role: { code: 'SCHOOL_ADMIN', name: '学校管理员', dataScope: 'SCHOOL', status: 'ACTIVE' },
    ...partial,
  }
}

function createFakePrisma(
  assignments: FakeAssignment[],
  grants: FakeGrant[],
  userStatus: 'ACTIVE' | 'DISABLED' = 'ACTIVE',
) {
  const prisma = {
    user: {
      async findUnique() {
        return { status: userStatus, deletedAt: null }
      },
    },
    userRole: {
      async findMany({ where }: { where: Record<string, unknown> }) {
        const validUntilConditions = where['OR'] as
          | Array<{ validUntil: null } | { validUntil: { gt: Date } }>
          | undefined
        const validFrom = (where['validFrom'] as { lte: Date } | undefined)?.lte
        const roleStatus = (where['role'] as { status?: string } | undefined)?.status

        return assignments
          .filter((item) => item.userId === where['userId'])
          .filter((item) => (where['revokedAt'] === null ? item.revokedAt === null : true))
          .filter((item) => (validFrom ? item.validFrom.getTime() <= validFrom.getTime() : true))
          .filter((item) => {
            if (!validUntilConditions) return true

            return validUntilConditions.some((condition) =>
              'validUntil' in condition && condition.validUntil === null
                ? item.validUntil === null
                : item.validUntil !== null &&
                  item.validUntil.getTime() >
                    (condition as { validUntil: { gt: Date } }).validUntil.gt.getTime(),
            )
          })
          .filter((item) => (roleStatus ? item.role.status === roleStatus : true))
          .toSorted((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      },
    },
    rolePermission: {
      async findMany({ where }: { where: Record<string, unknown> }) {
        const roleIds = (where['roleId'] as { in: string[] }).in
        const permissionCode = (where['permission'] as { code?: string } | undefined)?.code

        return grants
          .filter((grant) => roleIds.includes(grant.roleId))
          .filter((grant) => (permissionCode ? grant.permissionCode === permissionCode : true))
          .map((grant) => ({
            roleId: grant.roleId,
            permission: { code: grant.permissionCode },
          }))
      },
    },
  }

  return prisma as unknown as PrismaService
}

/** 默认不改变分配结果：资格过滤逻辑由 profiles 模块单测覆盖 */
const allowAllEligibility = {
  filterAssignments: async (_userId: string, assignments: unknown[]) => ({
    assignments,
    nextExpiry: null,
  }),
} as unknown as ConstructorParameters<typeof PermissionService>[1]

describe('PermissionService.findEffectiveAssignments', () => {
  it('只返回未撤销、已生效、未过期且角色启用的分配', async () => {
    const prisma = createFakePrisma(
      [
        assignment({ id: 'a-active', roleId: 'role-school' }),
        assignment({ id: 'a-revoked', roleId: 'role-school', revokedAt: PAST }),
        assignment({ id: 'a-future', roleId: 'role-school', validFrom: FUTURE }),
        assignment({ id: 'a-expired', roleId: 'role-school', validUntil: PAST }),
        assignment({
          id: 'a-disabled-role',
          roleId: 'role-disabled',
          role: {
            code: 'SCHOOL_ADMIN',
            name: '学校管理员',
            dataScope: 'SCHOOL',
            status: 'DISABLED',
          },
        }),
      ],
      [],
    )

    const service = new PermissionService(prisma, allowAllEligibility)
    const result = await service.findEffectiveAssignments('user-1', NOW)

    expect(result.map((item) => item.assignmentId)).toEqual(['a-active'])
  })

  it('用户被禁用时不返回任何有效分配（不依赖 AccessTokenGuard）', async () => {
    const prisma = createFakePrisma(
      [assignment({ id: 'a-active', roleId: 'role-school' })],
      [],
      'DISABLED',
    )
    const service = new PermissionService(prisma, allowAllEligibility)

    await expect(service.findEffectiveAssignments('user-1', NOW)).resolves.toEqual([])
  })

  it('有效分配携带角色编码与组织范围，供逐条计算数据范围', async () => {
    const prisma = createFakePrisma(
      [
        assignment({
          id: 'a-class-1',
          roleId: 'role-coordinator',
          scopeOrgUnitId: 'class-1',
          role: {
            code: 'CLASS_COORDINATOR',
            name: '班级事务协管员',
            dataScope: 'CLASS',
            status: 'ACTIVE',
          },
        }),
      ],
      [],
    )

    const [effective] = await new PermissionService(
      prisma,
      allowAllEligibility,
    ).findEffectiveAssignments('user-1', NOW)

    expect(effective).toMatchObject({
      roleCode: 'CLASS_COORDINATOR',
      dataScope: 'CLASS',
      scopeOrgUnitId: 'class-1',
    })
  })
})

describe('PermissionService.findPermissionAssignments', () => {
  const assignments = [
    assignment({
      id: 'a-teacher',
      roleId: 'role-teacher',
      role: { code: 'TEACHER', name: '教师', dataScope: 'ASSIGNED', status: 'ACTIVE' },
    }),
    assignment({
      id: 'a-class-1',
      roleId: 'role-coordinator',
      scopeOrgUnitId: 'class-1',
      role: {
        code: 'CLASS_COORDINATOR',
        name: '班级事务协管员',
        dataScope: 'CLASS',
        status: 'ACTIVE',
      },
    }),
    assignment({
      id: 'a-class-2',
      roleId: 'role-coordinator',
      scopeOrgUnitId: 'class-2',
      role: {
        code: 'CLASS_COORDINATOR',
        name: '班级事务协管员',
        dataScope: 'CLASS',
        status: 'ACTIVE',
      },
    }),
  ]

  const grants = [
    { roleId: 'role-teacher', permissionCode: 'graduation:progress:read' },
    { roleId: 'role-coordinator', permissionCode: 'graduation:progress:read' },
  ]

  it('按权限返回对应的多条角色分配，而不是扁平合并', async () => {
    const service = new PermissionService(
      createFakePrisma(assignments, grants),
      allowAllEligibility,
    )
    const result = await service.findPermissionAssignments(
      'user-1',
      'graduation:progress:read',
      NOW,
    )

    // 教师（ASSIGNED，无组织范围）+ 两个班级协管（CLASS，各自班级）都必须保留
    expect(result).toHaveLength(3)

    const scopedIds = result
      .map((item) => item.scopeOrgUnitId)
      .filter((id): id is string => id !== null)

    expect(new Set(scopedIds)).toEqual(new Set(['class-1', 'class-2']))
    expect(result.some((item) => item.scopeOrgUnitId === null)).toBe(true)
  })

  it('未授予该权限时返回空数组', async () => {
    const service = new PermissionService(
      createFakePrisma(assignments, grants),
      allowAllEligibility,
    )

    expect(
      await service.findPermissionAssignments('user-1', 'organization:unit:create', NOW),
    ).toEqual([])
    expect(await service.hasPermission('user-1', 'organization:unit:create')).toBe(false)
  })

  it('仅授予了部分角色权限时只返回授予的分配', async () => {
    const service = new PermissionService(
      createFakePrisma(assignments, [
        { roleId: 'role-coordinator', permissionCode: 'graduation:progress:read' },
      ]),
      allowAllEligibility,
    )
    const result = await service.findPermissionAssignments(
      'user-1',
      'graduation:progress:read',
      NOW,
    )

    expect(result.map((item) => item.assignmentId).toSorted()).toEqual(['a-class-1', 'a-class-2'])
  })

  it('getPermissionCodes 去重并排序', async () => {
    const service = new PermissionService(
      createFakePrisma(assignments, [
        { roleId: 'role-teacher', permissionCode: 'b:perm' },
        { roleId: 'role-coordinator', permissionCode: 'a:perm' },
        { roleId: 'role-coordinator', permissionCode: 'b:perm' },
      ]),
      allowAllEligibility,
    )

    expect(await service.getPermissionCodes('user-1')).toEqual(['a:perm', 'b:perm'])
  })
})
