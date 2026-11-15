import type { Prisma } from '../../../generated/prisma/client.js'

/**
 * 任职时间区间并发防护
 *
 * 统一使用半开区间 [validFrom, effectiveEnd)，其中
 * effectiveEnd = min(validUntil, revokedAt)，两者都为空表示无限远。
 *
 * 同一班级的所有任职写操作都必须先对 organization_units 行加排他锁，
 * 在锁内重新读取并检查重叠，避免 findFirst → create 的竞态。
 */

export function effectiveEnd(validUntil: Date | null, revokedAt: Date | null): number {
  const ends = [validUntil?.getTime(), revokedAt?.getTime()].filter(
    (value): value is number => typeof value === 'number',
  )

  return ends.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...ends)
}

export function intervalsOverlap(aStart: Date, aEnd: number, bStart: Date, bEnd: number): boolean {
  return aStart.getTime() < bEnd && bStart.getTime() < aEnd
}

/** 判断新任职区间是否与已有记录重叠 */
export function hasOverlap(
  candidate: { validFrom: Date; validUntil: Date | null },
  existing: Array<{ validFrom: Date; validUntil: Date | null; revokedAt: Date | null }>,
): boolean {
  const candidateEnd = effectiveEnd(candidate.validUntil, null)

  return existing.some((row) =>
    intervalsOverlap(
      candidate.validFrom,
      candidateEnd,
      row.validFrom,
      effectiveEnd(row.validUntil, row.revokedAt),
    ),
  )
}

/**
 * 按固定 ID 顺序锁定班级行，避免多班级操作互相死锁。
 *
 * 必须在 Prisma interactive transaction 内调用；
 * 锁持有到事务提交或回滚。
 */
export async function lockClassRows(
  tx: Prisma.TransactionClient,
  classIds: string[],
): Promise<void> {
  const ordered = [...new Set(classIds)].sort()

  for (const classId of ordered) {
    await tx.$queryRaw`SELECT id FROM organization_units WHERE id = ${classId} FOR UPDATE`
  }
}
