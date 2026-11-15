import { AUDIT_RESULTS, AUDIT_SOURCES } from '@graduation/shared'
import type { AuditJsonValue } from '@graduation/shared'
import { Injectable, Logger } from '@nestjs/common'

import type { Prisma } from '../../../generated/prisma/client.js'
import type { AuditLogModel } from '../../../generated/prisma/models.js'
import { getRequestId } from '../../common/request-context/request-context.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { sanitizeAuditPayload } from './audit-payload.js'
import { AuditRecordError } from './audit.errors.js'
import type { AuditRecordInput } from './audit.types.js'

/**
 * 允许写入审计的 Prisma 客户端
 *
 * 根 PrismaService 与 $transaction 回调中的事务客户端都满足该结构；
 * 传入事务客户端才能保证「业务变更 + 审计」同成同败。
 */
export type AuditWriteClient = Pick<Prisma.TransactionClient, 'auditLog'>

/**
 * 稳定动作编码：小写字母开头，至少两段，点分。
 *
 * 每段允许小写字母、数字与下划线，例如：
 * - student.profile.transfer
 * - student.profile.assign_class
 */
const ACTION_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/

/** 目标类型编码：大写下划线，例如 STUDENT_PROFILE */
const TARGET_TYPE_PATTERN = /^[A-Z][A-Z0-9_]*$/

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/

const MAX_ACTION_LENGTH = 128
const MAX_TARGET_TYPE_LENGTH = 64
const MAX_TARGET_ID_LENGTH = 64
const MAX_ACTOR_LABEL_LENGTH = 100
const MAX_REASON_LENGTH = 500

/**
 * 审计写入唯一入口
 *
 * 约定：
 * 1. 控制器与领域服务不得直接 prisma.auditLog.create()，只能调用本服务；
 * 2. 强一致业务操作必须把事务客户端传入 `record(input, tx)`；
 * 3. 写入失败向上抛出，由事务整体回滚，不静默吞掉；
 * 4. before/after 经 sanitizeAuditPayload 校验，敏感字段直接拒绝；
 * 5. 日志只输出动作与目标标识，不输出 before/after 内容。
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name)

  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditRecordInput, tx?: AuditWriteClient): Promise<AuditLogModel> {
    const data = this.buildCreateData(input)
    const client = tx ?? this.prisma

    try {
      return await client.auditLog.create({ data })
    } catch (error) {
      this.logger.error(
        `审计写入失败 action=${data.action} target=${data.targetType}:${data.targetId ?? '-'} requestId=${data.requestId ?? '-'}`,
        error instanceof Error ? error.stack : String(error),
      )

      throw error
    }
  }

  private buildCreateData(input: AuditRecordInput): Prisma.AuditLogUncheckedCreateInput {
    const action = this.requirePattern('action', input.action, ACTION_PATTERN, MAX_ACTION_LENGTH)
    const targetType = this.requirePattern(
      'targetType',
      input.targetType,
      TARGET_TYPE_PATTERN,
      MAX_TARGET_TYPE_LENGTH,
    )

    const actorType = input.actor.type
    const actorUserId =
      input.actor.type === 'USER' ? this.requireText('actor.userId', input.actor.userId, 36) : null
    const actorLabel =
      input.actor.type === 'SYSTEM'
        ? this.requireText('actor.label', input.actor.label, MAX_ACTOR_LABEL_LENGTH)
        : null

    const source = input.source ?? 'WEB'

    if (!AUDIT_SOURCES.includes(source)) {
      throw new AuditRecordError(`审计来源 source 非法：${String(source)}`)
    }

    const result = input.result ?? 'SUCCESS'

    if (!AUDIT_RESULTS.includes(result)) {
      throw new AuditRecordError(`审计结果 result 非法：${String(result)}`)
    }

    return {
      actorType,
      actorUserId,
      actorLabel,
      action,
      targetType,
      targetId: this.optionalText('targetId', input.targetId, MAX_TARGET_ID_LENGTH),
      scopeOrgUnitId: this.optionalText('scopeOrgUnitId', input.scopeOrgUnitId, 36),
      result,
      source,
      before: this.snapshot(input.before, 'before'),
      after: this.snapshot(input.after, 'after'),
      reason: this.optionalText('reason', input.reason, MAX_REASON_LENGTH),
      requestId: this.resolveRequestId(input.requestId),
    }
  }

  /** before / after 只接受纯 JSON 安全快照；显式 null 表示没有快照 */
  private snapshot(
    value: AuditJsonValue | null | undefined,
    field: 'before' | 'after',
  ): Prisma.InputJsonValue | undefined {
    if (value === null || value === undefined) return undefined

    const sanitized = sanitizeAuditPayload(value, field)

    // 顶层已排除 null，此处仅用于让类型与 Prisma 的 InputJsonValue 对齐
    if (sanitized === null) return undefined

    return sanitized
  }

  /** 显式传入优先；否则取当前请求上下文，系统任务可两者都为空 */
  private resolveRequestId(explicit?: string | null): string | null {
    const candidate = explicit?.trim() || getRequestId()

    if (!candidate) return null

    if (!REQUEST_ID_PATTERN.test(candidate)) {
      throw new AuditRecordError('审计 requestId 格式非法')
    }

    return candidate
  }

  private requireText(name: string, value: string, maxLength: number): string {
    const normalized = value.trim()

    if (!normalized) throw new AuditRecordError(`审计字段 ${name} 不能为空`)

    if (normalized.length > maxLength) {
      throw new AuditRecordError(`审计字段 ${name} 不能超过 ${maxLength} 个字符`)
    }

    return normalized
  }

  private optionalText(
    name: string,
    value: string | null | undefined,
    maxLength: number,
  ): string | null {
    if (value === null || value === undefined) return null

    const normalized = value.trim()

    if (!normalized) return null

    if (normalized.length > maxLength) {
      throw new AuditRecordError(`审计字段 ${name} 不能超过 ${maxLength} 个字符`)
    }

    return normalized
  }

  private requirePattern(name: string, value: string, pattern: RegExp, maxLength: number): string {
    const normalized = this.requireText(name, value, maxLength)

    if (!pattern.test(normalized)) {
      throw new AuditRecordError(`审计字段 ${name} 格式非法：${normalized}`)
    }

    return normalized
  }
}
