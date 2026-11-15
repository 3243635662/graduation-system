import { describe, expect, it } from 'vitest'

import type { Prisma } from '../../../generated/prisma/client.js'
import type { CoordinatorEligibilityService } from './coordinator-eligibility.service.js'
import { CoordinatorLifecycleService } from './coordinator-lifecycle.service.js'

type Basis = 'STUDENT_SELF' | 'HEAD_TEACHER' | 'COUNSELOR' | 'SCHOOL_OVERRIDE'

interface HarnessOptions {
  bases?: Basis[]
  assignmentExists?: boolean
}

function createHarness(options: HarnessOptions = {}) {
  const { bases = [], assignmentExists = true } = options

  const revoked: string[] = []
  const history: Array<Record<string, unknown>> = []
  const invalidated: string[] = []
  let current = assignmentExists

  const tx = {
    role: {
      async findUnique() {
        return { id: 'role-coordinator', code: 'CLASS_COORDINATOR' }
      },
    },
    userRole: {
      async findFirst() {
        // 当前授权表只保存仍然存在的授权，撤销即删除行
        return current
          ? {
              id: 'assignment-1',
              userId: 'user-1',
              scopeOrgUnitId: 'class-1',
              scopeKey: 'class-1',
              assignedById: 'actor-0',
              validFrom: new Date(0),
              validUntil: null,
            }
          : null
      },
      async delete({ where }: { where: { id: string } }) {
        current = false
        revoked.push(where.id)

        return { id: where.id }
      },
    },
    userRoleHistory: {
      async create({ data }: { data: Record<string, unknown> }) {
        history.push(data)

        return { id: `history-${history.length}`, ...data }
      },
    },
  }

  const eligibility = {
    evaluate: async () => ({
      eligible: bases.length > 0,
      bases,
      expiresAt: null,
    }),
  } as unknown as CoordinatorEligibilityService

  const invalidator = {
    invalidate: async (reason: string) => {
      invalidated.push(reason)
    },
  }

  const service = new CoordinatorLifecycleService(
    eligibility,
    invalidator as unknown as ConstructorParameters<typeof CoordinatorLifecycleService>[1],
  )

  return { service, tx: tx as unknown as Prisma.TransactionClient, revoked, history, invalidated }
}

describe('CoordinatorLifecycleService.revokeIfIneligible', () => {
  it('仍有其他资格时保留角色分配', async () => {
    const harness = createHarness({ bases: ['HEAD_TEACHER'] })

    const removed = await harness.service.revokeIfIneligible(
      'user-1',
      'class-1',
      'actor-1',
      harness.tx,
    )

    expect(removed).toEqual([])
    expect(harness.revoked).toEqual([])
    expect(harness.history).toHaveLength(0)
  })

  it('全部资格失效时在同一事务内写历史快照并删除当前授权', async () => {
    const harness = createHarness()

    const removed = await harness.service.revokeIfIneligible(
      'user-1',
      'class-1',
      'actor-1',
      harness.tx,
    )

    expect(removed).toEqual(['assignment-1'])
    expect(harness.revoked).toEqual(['assignment-1'])
    expect(harness.history).toHaveLength(1)
    expect(harness.history[0]).toMatchObject({
      userRoleId: 'assignment-1',
      userId: 'user-1',
      roleId: 'role-coordinator',
      roleCode: 'CLASS_COORDINATOR',
      scopeOrgUnitId: 'class-1',
      scopeKey: 'class-1',
      revokedById: 'actor-1',
      revocationReason: 'QUALIFICATION_LOST',
    })
  })

  it('没有有效分配时不做任何写入', async () => {
    const harness = createHarness({ assignmentExists: false })

    const removed = await harness.service.revokeIfIneligible(
      'user-1',
      'class-1',
      'actor-1',
      harness.tx,
    )

    expect(removed).toEqual([])
    expect(harness.revoked).toEqual([])
    expect(harness.history).toHaveLength(0)
  })
})

describe('CoordinatorLifecycleService.revokeStudentBasisIfOnly', () => {
  it('仅靠本班学生身份获得资格时终止旧班级授权', async () => {
    const harness = createHarness({ bases: ['STUDENT_SELF'] })

    const removed = await harness.service.revokeStudentBasisIfOnly(
      'user-1',
      'class-1',
      'actor-1',
      harness.tx,
    )

    expect(removed).toEqual(['assignment-1'])
    expect(harness.history[0]?.['revocationReason']).toBe('QUALIFICATION_LOST')
  })

  it('同时具备职务资格时保留协管授权', async () => {
    const harness = createHarness({ bases: ['STUDENT_SELF', 'COUNSELOR'] })

    const removed = await harness.service.revokeStudentBasisIfOnly(
      'user-1',
      'class-1',
      'actor-1',
      harness.tx,
    )

    expect(removed).toEqual([])
    expect(harness.revoked).toEqual([])
  })

  it('已经没有任何资格时不做撤销（交由 revokeIfIneligible 处理）', async () => {
    const harness = createHarness({ bases: [] })

    const removed = await harness.service.revokeStudentBasisIfOnly(
      'user-1',
      'class-1',
      'actor-1',
      harness.tx,
    )

    expect(removed).toEqual([])
    expect(harness.history).toHaveLength(0)
  })
})
