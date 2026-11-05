import { describe, expect, it, vi } from 'vitest'

import { getPaginationArgs, paginate } from './pagination.util.js'

describe('PaginationUtil', () => {
  describe('getPaginationArgs', () => {
    it('第一页应该从第 0 条记录开始查询', () => {
      expect(
        getPaginationArgs({
          page: 1,
          pageSize: 10,
        }),
      ).toEqual({
        skip: 0,
        take: 10,
      })
    })

    it('第二页应该跳过前 10 条记录', () => {
      expect(
        getPaginationArgs({
          page: 2,
          pageSize: 10,
        }),
      ).toEqual({
        skip: 10,
        take: 10,
      })
    })

    it('应该正确计算不同页码和每页数量', () => {
      expect(
        getPaginationArgs({
          page: 3,
          pageSize: 20,
        }),
      ).toEqual({
        skip: 40,
        take: 20,
      })
    })
  })

  describe('paginate', () => {
    it('应该同时执行列表查询和总数查询，并返回分页结果', async () => {
      const mockList = [
        { id: 'user-001', name: '张三' },
        { id: 'user-002', name: '李四' },
      ]

      const findMany = vi.fn().mockResolvedValue(mockList)
      const count = vi.fn().mockResolvedValue(35)

      const result = await paginate(
        {
          page: 2,
          pageSize: 10,
        },
        findMany,
        count,
      )

      expect(findMany).toHaveBeenCalledWith({
        skip: 10,
        take: 10,
      })

      expect(count).toHaveBeenCalledOnce()

      expect(result).toEqual({
        list: mockList,
        total: 35,
      })
    })

    it('应该正确处理没有查询结果的情况', async () => {
      const findMany = vi.fn().mockResolvedValue([])
      const count = vi.fn().mockResolvedValue(0)

      const result = await paginate(
        {
          page: 1,
          pageSize: 10,
        },
        findMany,
        count,
      )

      expect(result).toEqual({
        list: [],
        total: 0,
      })
    })

    it('数据库查询失败时应该将异常向上传递', async () => {
      const error = new Error('数据库查询失败')

      const findMany = vi.fn().mockRejectedValue(error)
      const count = vi.fn().mockResolvedValue(10)

      await expect(
        paginate(
          {
            page: 1,
            pageSize: 10,
          },
          findMany,
          count,
        ),
      ).rejects.toThrow('数据库查询失败')
    })
  })
})
