/** 表格列定义 */
export interface DataTableColumn {
  /** 字段名，同时作为插槽名后缀：`#cell-<key>` */
  key: string
  title: string
  /** 列宽，如 '160px' / '20%' */
  width?: string
  align?: 'left' | 'center' | 'right'
  /** 小屏（<768px）隐藏该列，避免横向挤压 */
  hideOnMobile?: boolean
}

/** 自定义单元格插槽的入参 */
export interface DataTableCellSlotProps<TRow = Record<string, unknown>> {
  row: TRow
  index: number
  /** 该列的原始值（未经过格式化） */
  value: unknown
}
