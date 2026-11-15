/**
 * 审计记录非法
 *
 * 属于调用方编码错误：一旦抛出，必须让所在业务事务回滚，
 * 不能为了「不影响主流程」而静默丢弃审计。
 */
export class AuditRecordError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuditRecordError'
  }
}
