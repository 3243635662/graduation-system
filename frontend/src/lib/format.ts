import dayjs from 'dayjs'

/** 后端时间字段为空时的占位符 */
const EMPTY_PLACEHOLDER = '—'

/**
 * 统一的日期展示
 *
 * 后端返回 ISO 8601 字符串（或 null），这里做空值与非法值兜底，
 * 避免页面上出现 `Invalid Date`。
 */
export function formatDate(value: string | null | undefined): string {
  if (!value) return EMPTY_PLACEHOLDER

  const date = dayjs(value)

  return date.isValid() ? date.format('YYYY-MM-DD') : EMPTY_PLACEHOLDER
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return EMPTY_PLACEHOLDER

  const date = dayjs(value)

  return date.isValid() ? date.format('YYYY-MM-DD HH:mm') : EMPTY_PLACEHOLDER
}

/** 空字符串统一展示为破折号 */
export function orPlaceholder(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return EMPTY_PLACEHOLDER

  return String(value)
}
