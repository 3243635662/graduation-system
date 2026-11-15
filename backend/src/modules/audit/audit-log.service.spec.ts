import { ForbiddenException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'

import type { PrismaService } from '../../prisma/prisma.service.js'
import type { OrganizationScopeService } from '../rbac/authorization/organization-scope.service.js'
import type { AuditLogListQuery } from './audit-log.schema.js'
import { AuditLogService } from './audit-log.service.js'

type Args = Record<string, unknown>

const ROW = {
  id: 'audit-1',
  actorType: 'USER',
  actorUserId: 'user-1',
  actorLabel: null,
  action: 'student.profile.transfer',
  targetType: 'STUDENT_PROFILE',
  targetId: 'profile-1',
  scopeOrgUnitId: 'class-2',
  result: 'SUCCESS',
  source: 'WEB',
  before: { classId: 'class-1' },
  after: { classId: 'class-2' },
  reason: '专业内调整',
  requestId: 'req-1',
  createdAt: new Date('2026-11-15T10:00:00.000Z'),
  actor: { realName: '管理员' },
}

const baseQuery: AuditLogListQuery = {
  page: 3,
  pageSize: 10,
  from: new Date('2026-11-01T00:00:00.000Z'),
  to: new Date('2026-11-30T23:59:59.000Z'),
  actorUserId: '11111111-1111-4111-8111-111111111111',
  action: 'student.profile.transfer',
  targetType: 'STUDENT_PROFILE',
  targetId: 'profile-1',
  source: 'WEB',
  result: 'SUCCESS',
}

function createHarness(scope: unknown) {
  const findManyCalls: Args[] = []
  const countCalls: Args[] = []

  const prisma = {
    auditLog: {
      findMany: async (args: Args) => {
        findManyCalls.push(args)

        return [ROW]
      },
      count: async (args: Args) => {
        countCalls.push(args)

        return 1
      },
    },
  } as unknown as PrismaService

  const scopeService = {
    resolve: async () => scope,
  } as unknown as OrganizationScopeService

  return {
    service: new AuditLogService(prisma, scopeService),
    findManyCalls,
    countCalls,
  }
}

describe('AuditLogService', () => {
  it('按组织子树过滤并透传分页、时间与业务筛选条件', async () => {
    const harness = createHarness({ kind: 'SUBTREE', orgUnitIds: ['major-a', 'class-a1'] })

    const result = await harness.service.list('actor-1', baseQuery)

    expect(result.total).toBe(1)
    expect(result.list[0]).toMatchObject({
      id: 'audit-1',
      actorName: '管理员',
      before: { classId: 'class-1' },
      after: { classId: 'class-2' },
    })

    const args = harness.findManyCalls[0]!
    const where = args['where'] as Args

    expect(where).toMatchObject({
      scopeOrgUnitId: { in: ['major-a', 'class-a1'] },
      actorUserId: baseQuery.actorUserId,
      action: 'student.profile.transfer',
      targetType: 'STUDENT_PROFILE',
      targetId: 'profile-1',
      source: 'WEB',
      result: 'SUCCESS',
      createdAt: { gte: baseQuery.from, lte: baseQuery.to },
    })
    expect(args).toMatchObject({ skip: 20, take: 10 })
    expect(args['orderBy']).toEqual([{ createdAt: 'desc' }, { id: 'desc' }])
  })

  it('GLOBAL 范围不加组织过滤', async () => {
    const harness = createHarness({ kind: 'ALL' })

    await harness.service.list('actor-1', baseQuery)

    expect(harness.findManyCalls[0]!['where']).not.toHaveProperty('scopeOrgUnitId')
  })

  it('没有可用组织范围时直接 403，不返回空列表', async () => {
    const harness = createHarness({ kind: 'NONE' })

    await expect(harness.service.list('actor-1', baseQuery)).rejects.toBeInstanceOf(
      ForbiddenException,
    )
    expect(harness.findManyCalls).toHaveLength(0)
  })

  it('未提供筛选条件时只带分页与组织范围', async () => {
    const harness = createHarness({ kind: 'SUBTREE', orgUnitIds: ['class-a1'] })

    await harness.service.list('actor-1', { page: 1, pageSize: 20 })

    const where = harness.findManyCalls[0]!['where'] as Args

    expect(where).toEqual({ scopeOrgUnitId: { in: ['class-a1'] } })
  })
})
