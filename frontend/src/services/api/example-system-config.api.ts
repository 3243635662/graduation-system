/**
 * example-system-config.api.ts
 *
 * 【纯前端 Mock 请求范例】
 *
 * 用途：
 *   在后端接口尚未开发完成时，使用内存中的假数据 + setTimeout 模拟网络延迟，
 *   让前端 UI 可以先跑通数据流（loading、成功、失败状态）和组件交互。
 *
 * 技术要点：
 *   - 只用于前端本地开发调试，不会发出真实 HTTP 请求
 *   - 结合 @tanstack/vue-query 的 useQuery / useMutation 管理请求状态
 *   - 命名前缀 "example-" 表示此文件仅作演示，后续接入真实接口后可删除
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'

import type { ApiResponse } from '../types/response.type'

/** 系统配置项的数据结构（临时类型，后续从 @graduation/shared 中统一维护） */
interface ISystemConfig {
  key: string
  value: string // JSON 字符串，存储任意配置内容
  description?: string
}

// ——————————————————————————————————————————————
// Mock 内存数据（模拟数据库中已存在的配置记录）
// ——————————————————————————————————————————————
const mockData: ISystemConfig[] = [
  {
    key: 'appearance_config',
    value: JSON.stringify({ theme: 'dark', font: 'inter' }),
    description: '应用外观配置，包括主题色、圆角和内容布局等。',
  },
]

/** 构造一个与后端响应拦截器一致的成功响应对象 */
function buildSuccessResponse<T>(data: T): ApiResponse<T> {
  return {
    code: 0,
    message: '请求成功',
    data,
  }
}
// ——————————————————————————————————————————————
// Vue Query Hooks
// ——————————————————————————————————————————————

/**
 * 【查询】根据 key 获取单条系统配置。
 *
 * 使用 useQuery 管理请求状态，自动缓存结果。
 * queryKey 包含 key，当 key 变化时会自动重新请求。
 */
export function useGetSystemConfigByKeyQuery(key: string) {
  return useQuery<ApiResponse<ISystemConfig>, Error>({
    queryKey: ['useGetSystemConfigByKeyQuery', key],
    queryFn: async () => {
      // 模拟 1 秒网络延迟，真实接口替换为 apiFetch('/system-config/' + key) 即可
      const config = await new Promise<ISystemConfig | undefined>((resolve, reject) => {
        setTimeout(() => {
          const found = mockData.find((item) => item.key === key)
          if (!found) reject(new Error('Config not found'))
          resolve(found)
        }, 1000)
      })
      if (!config) throw new Error('Config not found')
      return buildSuccessResponse(config)
    },
  })
}

/**
 * 【修改】更新指定 key 的系统配置。
 *
 * 使用 useMutation 管理写操作，成功后自动刷新关联的查询缓存。
 */
export function useUpdateSystemConfigByKeyMutation(key: string) {
  const queryClient = useQueryClient()

  return useMutation<ApiResponse<ISystemConfig>, Error, ISystemConfig>({
    mutationKey: ['useUpdateSystemConfigByKeyMutation', key],
    mutationFn: async (data: ISystemConfig) => {
      // 模拟 100ms 写入延迟，真实接口替换为 apiFetch('/system-config/' + key, { method: 'put', body: data })
      return new Promise<ApiResponse<ISystemConfig>>((resolve) => {
        setTimeout(() => resolve(buildSuccessResponse(data)), 100)
      })
    },
    onSuccess: () => {
      // 写入成功后，使该 key 对应的查询缓存失效，触发自动重新拉取
      queryClient.invalidateQueries({ queryKey: ['useGetSystemConfigByKeyQuery', key] })
    },
  })
}

/**
 * 【创建】新建一条系统配置。
 *
 * 成功后使所有系统配置查询缓存失效，以保证列表数据的一致性。
 */
export function useCreateSystemMutation() {
  const queryClient = useQueryClient()

  return useMutation<ApiResponse<ISystemConfig>, Error, ISystemConfig>({
    mutationKey: ['useCreateSystemMutation'],
    mutationFn: async (data: ISystemConfig) => {
      // 真实接口替换为 apiFetch('/system-config', { method: 'post', body: data })
      return new Promise<ApiResponse<ISystemConfig>>((resolve) => {
        setTimeout(() => resolve(buildSuccessResponse(data)), 100)
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['useGetSystemConfigByKeyQuery'] })
    },
  })
}
