import type { AuditActorType, AuditJsonValue, AuditResult, AuditSource } from '@graduation/shared'

/**
 * 审计写入输入
 *
 * 与 Prisma 模型不同，这里只暴露调用方真正需要提供的字段：
 * 时间由服务端生成，id 由数据库生成，before/after 只允许安全字段。
 */

export interface AuditUserActor {
  type: Extract<AuditActorType, 'USER'>
  userId: string
}

export interface AuditSystemActor {
  type: Extract<AuditActorType, 'SYSTEM'>
  /** 系统任务标识，例如 system.file-cleanup */
  label: string
}

/** 用户操作必须给出 actorUserId；系统任务必须给出可读标签 */
export type AuditActor = AuditUserActor | AuditSystemActor

export interface AuditRecordInput {
  actor: AuditActor

  /** 稳定动作编码，形如 student.profile.transfer */
  action: string

  /** 目标类型编码，形如 STUDENT_PROFILE */
  targetType: string
  targetId?: string | null

  /** 操作归属的组织范围，用于查询时的数据范围过滤 */
  scopeOrgUnitId?: string | null

  /** 默认 SUCCESS；FAILURE 仅用于独立的安全事件，不得伪装成已提交的业务变更 */
  result?: AuditResult

  /** 默认 WEB */
  source?: AuditSource

  /** 变更前的最小安全快照 */
  before?: AuditJsonValue | null

  /** 变更后的最小安全快照 */
  after?: AuditJsonValue | null

  /** 业务原因（转班、改派等要求填写原因的操作用） */
  reason?: string | null

  /** 缺省时自动取当前请求的 requestId；系统任务可显式传入 */
  requestId?: string | null
}
