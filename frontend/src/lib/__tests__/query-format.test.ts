import { describe, expect, it } from 'vitest'

import { formatDate, formatDateTime, orPlaceholder } from '../format'
import { toQueryParams } from '../query'

describe('toQueryParams', () => {
  it('丢弃空字符串、null 与 undefined', () => {
    expect(
      toQueryParams({ page: 1, pageSize: 10, keyword: '', status: undefined, classId: null }),
    ).toEqual({ page: 1, pageSize: 10 })
  })

  it('保留 false 与 0 这类「假值」', () => {
    expect(toQueryParams({ unassignedOnly: false, page: 0 })).toEqual({
      unassignedOnly: false,
      page: 0,
    })
  })

  it('丢弃对象与数组，避免把复杂结构拼进 URL', () => {
    expect(toQueryParams({ ids: ['a', 'b'], filter: { a: 1 }, keyword: 'abc' })).toEqual({
      keyword: 'abc',
    })
  })
})

describe('format helpers', () => {
  it('空值统一显示破折号', () => {
    expect(formatDate(null)).toBe('—')
    expect(formatDateTime(undefined)).toBe('—')
    expect(orPlaceholder('')).toBe('—')
    expect(orPlaceholder(0)).toBe('0')
  })

  it('格式化合法时间', () => {
    expect(formatDate('2024-03-05T10:20:30.000Z')).toMatch(/^2024-03-0[45]$/)
    expect(formatDateTime('2024-03-05T10:20:30.000Z')).toMatch(/^2024-03-0[45] \d{2}:\d{2}$/)
  })

  it('非法时间不会输出 Invalid Date', () => {
    expect(formatDate('not-a-date')).toBe('—')
  })
})
