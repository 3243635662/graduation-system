/**
 * 查询参数规范化
 *
 * 列表接口的筛选条件在 UI 上大多是「可留空」的，
 * 空字符串 / null / undefined 必须被丢弃，否则后端会把 `status=` 当成非法枚举而返回 400。
 * 只保留 JSON 基本类型，避免把对象/数组误当成查询条件。
 */
export type QueryParamValue = string | number | boolean

export function toQueryParams<T extends object>(params: T): Record<string, QueryParamValue> {
  const result: Record<string, QueryParamValue> = {}

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      result[key] = value
    }
  }

  return result
}
