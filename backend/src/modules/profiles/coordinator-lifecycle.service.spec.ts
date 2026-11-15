import { describe, expect, it } from 'vitest'

import type { Prisma } from '../../../generated/prisma/client.js'
import type { CoordinatorEligibilityService } from './coordinator-eligibility.service.js'
import { CoordinatorLifecycleService } from './coordinator-lifecycle.service.js'

function createHarness(eligible: boolean, assignmentExists = true) {
  const revoked: string[] = []
  const invalidated: string[] = []

  const tx = {
    role: {
      async findUnique() {
        return { id: 'role-coordinator' }
      },
    },
    userRole: {
      async findFirst() {
        return assignmentExists ? { id: 'assignment-1' } : null
      },
      async updateMany({ where }: { where: { id: string } }) {
        if (!assignmentExists) return { count: 0 }

        assignmentExists = false
        revoked.push(where.id)

        return { count: 1 }
      },
    },
  }

  const eligibility = {
    evaluate: async () => ({ eligible, bases: [], expiresAt: null }),
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

  return { service, tx: tx as unknown as Prisma.TransactionClient, revoked, invalidated }
}

describe('CoordinatorLifecycleService', () => {
  it('仍有其他资格时保留角色分配', async () => {
    const harness = createHarness(true)

    const removed = await harness.service.revokeIfIneligible(
      'user-1',
      'class-1',
      'actor-1',
      harness.tx,
    )

    expect(removed).toEqual([])
    expect(harness.revoked).toEqual([])
  })

  it('全部资格失效时在同一事务内软撤销角色', async () => {
    const harness = createHarness(false)

    const removed = await harness.service.revokeIfIneligible(
      'user-1',
      'class-1',
      'actor-1',
      harness.tx,
    )

    expect(removed).toEqual(['assignment-1'])
    expect(harness.revoked).toEqual(['assignment-1'])
  })

  it('没有有效分配时不做任何写入', async () => {
    const harness = createHarness(false, false)

    const removed = await harness.service.revokeIfIneligible(
      'user-1',
      'class-1',
      'actor-1',
      harness.tx,
    )

    expect(removed).toEqual([])
    expect(harness.revoked).toEqual([])
  })
})
