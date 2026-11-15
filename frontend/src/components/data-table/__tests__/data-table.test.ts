import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import DataTable from '../data-table.vue'
import type { DataTableColumn } from '../types'

interface Row {
  id: string
  name: string
  status: string
}

const columns: DataTableColumn[] = [
  { key: 'name', title: '姓名' },
  { key: 'status', title: '状态' },
]

const rows: Row[] = [
  { id: '1', name: '张三', status: 'ACTIVE' },
  { id: '2', name: '李四', status: 'DISABLED' },
]

describe('DataTable', () => {
  it('渲染表头与行数据', () => {
    const wrapper = mount(DataTable, {
      props: { columns, rows, total: 0 },
    })

    expect(wrapper.text()).toContain('姓名')
    expect(wrapper.text()).toContain('张三')
    expect(wrapper.text()).toContain('DISABLED')
  })

  it('支持 #cell-<key> 自定义单元格', () => {
    const wrapper = mount(DataTable, {
      props: { columns, rows, total: 0 },
      slots: {
        'cell-name': '<span class="custom-cell">自定义姓名</span>',
      },
    })

    expect(wrapper.findAll('.custom-cell')).toHaveLength(2)
    expect(wrapper.text()).not.toContain('张三')
  })

  it('无数据时展示空态', () => {
    const wrapper = mount(DataTable, {
      props: { columns, rows: [], total: 0, emptyTitle: '没有匹配的账号' },
    })

    expect(wrapper.text()).toContain('没有匹配的账号')
  })

  it('加载中不渲染数据行', () => {
    const wrapper = mount(DataTable, {
      props: { columns, rows, total: 2, loading: true },
    })

    expect(wrapper.text()).not.toContain('张三')
    expect(wrapper.text()).not.toContain('没有匹配')
  })

  it('请求失败时展示错误信息', () => {
    const wrapper = mount(DataTable, {
      props: { columns, rows: [], total: 0, error: '没有访问该组织范围用户的权限' },
    })

    expect(wrapper.text()).toContain('加载失败')
    expect(wrapper.text()).toContain('没有访问该组织范围用户的权限')
  })

  it('点击行时派发 row-click', async () => {
    const wrapper = mount(DataTable, {
      props: { columns, rows, total: 0, clickable: true },
    })

    await wrapper.findAll('tbody tr')[1].trigger('click')

    expect(wrapper.emitted('row-click')?.[0]).toEqual([rows[1]])
  })
})
