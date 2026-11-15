import { describe, expect, it } from 'vitest'

import { effectiveEnd, hasOverlap, intervalsOverlap } from './coordinator-concurrency.js'

const at = (value: string) => new Date(value)

describe('任职区间并发工具', () => {
  it('使用半开区间：相邻任职不算重叠', () => {
    expect(currentOverlap('2030-01-01', '2030-06-30', '2030-06-30', '2030-12-31')).toBe(false)
  })

  it('开始时间落在已有区间内视为重叠', () => {
    expect(currentOverlap('2030-01-01', '2030-06-30', '2030-03-01', '2030-09-30')).toBe(true)
  })

  it('结束时间落在已有区间内视为重叠', () => {
    expect(currentOverlap('2030-03-01', '2030-09-30', '2030-01-01', '2030-06-30')).toBe(true)
  })

  it('无限期末尾按无限远处理', () => {
    expect(
      hasOverlap({ validFrom: at('2031-01-01'), validUntil: null }, [
        {
          validFrom: at('2030-01-01'),
          validUntil: null,
          revokedAt: null,
        },
      ]),
    ).toBe(true)
  })

  it('提前撤销时间作为实际结束时间参与判定', () => {
    expect(effectiveEnd(null, at('2030-03-01'))).toBe(at('2030-03-01').getTime())

    // 旧任职 1 月撤销，新任职 3 月开始，不应冲突
    expect(
      hasOverlap({ validFrom: at('2030-03-01'), validUntil: null }, [
        {
          validFrom: at('2030-01-01'),
          validUntil: null,
          revokedAt: at('2030-02-01'),
        },
      ]),
    ).toBe(false)
  })
})

function currentOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return intervalsOverlap(at(aStart), at(aEnd).getTime(), at(bStart), at(bEnd).getTime())
}
