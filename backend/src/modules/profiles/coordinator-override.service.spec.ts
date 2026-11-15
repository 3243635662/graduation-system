import { BadRequestException, ForbiddenException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'

import type { PrismaService } from '../../prisma/prisma.service.js'
import type { OrganizationService } from '../rbac/organizations/organization.service.js'
import { CoordinatorLifecycleService } from './coordinator-lifecycle.service.js'
import { CoordinatorOverrideService } from './coordinator-override.service.js'

function createHarness(options: { schoolAdmin?: boolean; existingAssignment?: boolean } = {}) {
  const overrides: Array<Record<string, unknown>> = []
  const assignments: Array<Record<string, unknown>> = []
  const invalidated: string[] = []
  let sequence = 0

  const prisma = {
    $transaction: async (callback: (tx: unknown) => unknown) => callback(prisma),
    $queryRaw: async () => [],
    user: {
      async findUnique() {
        return { id: 'target-user', status: 'ACTIVE', deletedAt: null }
      },
    },
    role: {
      async findUnique() {
        return { id: 'role-coordinator' }
      },
    },
    userRole: {
      async findMany() {
        return options.schoolAdmin === false ? [] : [{ scopeOrgUnitId: 'school-1' }]
      },
      async findFirst() {
        return options.existingAssignment ? { id: 'assignment-existing' } : null
      },
      async create({ data }: { data: Record<string, unknown> }) {
        const row = { id: `assignment-${++sequence}`, revokedAt: null, ...data }

        assignments.push(row)

        return row
      },
      async updateMany() {
        return { count: 1 }
      },
    },
    coordinatorQualificationOverride: {
      async findMany() {
        return overrides.map((row) => ({
          validFrom: row['validFrom'] ?? new Date(),
          validUntil: row['validUntil'] ?? null,
          revokedAt: row['revokedAt'] ?? null,
        }))
      },
      async create({ data }: { data: Record<string, unknown> }) {
        const row = {
          id: `override-${++sequence}`,
          createdAt: new Date(),
          revokedAt: null,
          validFrom: new Date(),
          ...data,
        }

        overrides.push(row)

        return row
      },
      async findUnique({ where }: { where: { id: string } }) {
        return overrides.find((row) => row['id'] === where.id) ?? null
      },
      async updateMany({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
        const row = overrides.find((item) => item['id'] === where.id)

        if (!row) return { count: 0 }

        Object.assign(row, data)

        return { count: 1 }
      },
      async findUniqueOrThrow({ where }: { where: { id: string } }) {
        return overrides.find((row) => row['id'] === where.id)
      },
    },
  }

  const organizationService = {
    findById: async (id: string) => ({
      id,
      name: '软件工程一班',
      code: 'SE-1',
      type: 'CLASS',
      status: 'ACTIVE',
      sortOrder: 1,
      parentId: 'major-1',
      children: [],
    }),
    isPathActive: async () => true,
    isWithinScope: async (targetId: string, scopeId: string) =>
      scopeId === 'school-1' && targetId === 'class-1',
  } as unknown as OrganizationService

  const lifecycle = {
    invalidateMenus: async (reason: string) => {
      invalidated.push(reason)
    },
    revokeIfIneligible: async () => [],
  } as unknown as CoordinatorLifecycleService

  const service = new CoordinatorOverrideService(
    prisma as unknown as PrismaService,
    organizationService,
    lifecycle,
  )

  return { service, overrides, assignments, invalidated }
}

describe('CoordinatorOverrideService', () => {
  it('非学校管理员不能创建特殊覆盖', async () => {
    const harness = createHarness({ schoolAdmin: false })

    await expect(
      harness.service.create(
        { userId: 'target-user', classId: 'class-1', reason: '学院指定人员' },
        'actor-dept',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException)

    expect(harness.overrides).toHaveLength(0)
  })

  it('特殊覆盖必须填写原因', async () => {
    const harness = createHarness()

    await expect(
      harness.service.create(
        { userId: 'target-user', classId: 'class-1', reason: '   ' },
        'actor-school',
      ),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('创建覆盖时在同一事务内补齐 CLASS_COORDINATOR 分配', async () => {
    const harness = createHarness()

    const override = await harness.service.create(
      { userId: 'target-user', classId: 'class-1', reason: '学院指定人员' },
      'actor-school',
    )

    expect(override.id).toBeTruthy()
    expect(harness.overrides).toHaveLength(1)
    expect(harness.assignments).toHaveLength(1)
    expect(harness.assignments[0]?.['scopeOrgUnitId']).toBe('class-1')
    expect(harness.invalidated).toContain('coordinator.override.create')
  })

  it('已存在有效分配时不会重复创建', async () => {
    const harness = createHarness({ existingAssignment: true })

    await harness.service.create(
      { userId: 'target-user', classId: 'class-1', reason: '学院指定人员' },
      'actor-school',
    )

    expect(harness.assignments).toHaveLength(0)
  })

  it('撤销覆盖后触发资格重算与菜单失效', async () => {
    const harness = createHarness()

    const override = await harness.service.create(
      { userId: 'target-user', classId: 'class-1', reason: '学院指定人员' },
      'actor-school',
    )

    const revoked = await harness.service.revoke(String(override.id), 'actor-school')

    expect(revoked?.['revokedAt']).toBeInstanceOf(Date)
    expect(harness.invalidated).toContain('coordinator.override.revoke')
  })

  it('目标班级不在学校范围内时拒绝创建', async () => {
    const harness = createHarness()

    await expect(
      harness.service.create(
        { userId: 'target-user', classId: 'class-outside', reason: '越权指定' },
        'actor-school',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })
})
