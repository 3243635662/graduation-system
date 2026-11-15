import { beforeEach, describe, expect, it } from 'vitest'

import { runWithRequestContext } from '../../common/request-context/request-context.js'
import type { PrismaService } from '../../prisma/prisma.service.js'
import { AuditRecordError } from './audit.errors.js'
import { AuditService, type AuditWriteClient } from './audit.service.js'
import type { AuditRecordInput } from './audit.types.js'

type CreateArgs = { data: Record<string, unknown> }

function createAuditClient(options: { fail?: Error } = {}) {
  const created: Array<Record<string, unknown>> = []

  const client = {
    auditLog: {
      create: async ({ data }: CreateArgs) => {
        if (options.fail) throw options.fail

        created.push(data)

        return { id: `audit-${created.length}`, createdAt: new Date(), ...data }
      },
    },
  }

  return { client, created }
}

const baseInput: AuditRecordInput = {
  actor: { type: 'USER', userId: 'user-1' },
  action: 'student.profile.transfer',
  targetType: 'STUDENT_PROFILE',
  targetId: 'profile-1',
  scopeOrgUnitId: 'class-2',
  before: { classId: 'class-1' },
  after: { classId: 'class-2' },
  reason: '专业内调整',
}

describe('AuditService.record', () => {
  let prismaClient: ReturnType<typeof createAuditClient>
  let service: AuditService

  beforeEach(() => {
    prismaClient = createAuditClient()
    service = new AuditService({
      auditLog: prismaClient.client.auditLog,
    } as unknown as PrismaService)
  })

  it('正常写入并补齐默认来源与结果', async () => {
    await service.record({ ...baseInput, requestId: 'req-0001' })

    expect(prismaClient.created).toHaveLength(1)
    expect(prismaClient.created[0]).toMatchObject({
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
      requestId: 'req-0001',
    })
  })

  it('系统任务必须使用 SYSTEM 类型并记录标签', async () => {
    await service.record({
      actor: { type: 'SYSTEM', label: 'system.file-cleanup' },
      action: 'file.orphan.cleanup',
      targetType: 'FILE_OBJECT',
      source: 'SYSTEM',
    })

    expect(prismaClient.created[0]).toMatchObject({
      actorType: 'SYSTEM',
      actorUserId: null,
      actorLabel: 'system.file-cleanup',
      source: 'SYSTEM',
      result: 'SUCCESS',
      requestId: null,
    })
  })

  it('传入事务客户端时只使用事务客户端写入', async () => {
    const tx = createAuditClient()
    const txClient = tx.client as unknown as AuditWriteClient

    await service.record(baseInput, txClient)

    expect(tx.created).toHaveLength(1)
    expect(prismaClient.created).toHaveLength(0)
  })

  it('before/after 含敏感字段时拒绝写入', async () => {
    await expect(
      service.record({
        ...baseInput,
        before: { classId: 'class-1', passwordHash: 'hash' },
      }),
    ).rejects.toBeInstanceOf(AuditRecordError)

    expect(prismaClient.created).toHaveLength(0)
  })

  it('审计写入异常向上抛出，不静默吞掉', async () => {
    const failure = new Error('audit insert failed')
    const failing = createAuditClient({ fail: failure })
    const failingService = new AuditService({
      auditLog: failing.client.auditLog,
    } as unknown as PrismaService)

    await expect(failingService.record(baseInput)).rejects.toBe(failure)
    expect(failing.created).toHaveLength(0)
  })

  it('未显式传入 requestId 时自动取自请求上下文', async () => {
    await runWithRequestContext({ requestId: 'req-from-context-0001' }, () =>
      service.record(baseInput),
    )

    expect(prismaClient.created[0]).toMatchObject({ requestId: 'req-from-context-0001' })
  })

  it('校验动作编码、必填演员与原因长度', async () => {
    await expect(service.record({ ...baseInput, action: 'Transfer' })).rejects.toBeInstanceOf(
      AuditRecordError,
    )

    await expect(
      service.record({ ...baseInput, actor: { type: 'USER', userId: '  ' } }),
    ).rejects.toBeInstanceOf(AuditRecordError)

    await expect(service.record({ ...baseInput, reason: 'x'.repeat(501) })).rejects.toBeInstanceOf(
      AuditRecordError,
    )

    expect(prismaClient.created).toHaveLength(0)
  })
})
