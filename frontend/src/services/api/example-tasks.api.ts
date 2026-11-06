/**
 * example-tasks.api.ts
 *
 * 【真实 HTTP 请求规范范例】⭐ 重点参考
 *
 * 用途：
 *   演示本项目前端接口文件的**标准写法**，包含：
 *     1. 底层传输层（Transport Layer）：纯函数，直接调用 apiFetch 发送 HTTP 请求，
 *        不依赖 Vue 响应式，可单独进行单元测试。
 *     2. Vue Query Hooks 层：将传输函数包装为响应式 Hook，
 *        自动管理 loading、error、缓存、自动刷新等状态。
 *
 * 写新接口时的参考步骤：
 *   1. 定义该模块的业务数据类型（如 ITask）
 *   2. 写底层纯函数（fetchXxx、createXxx 等），调用 apiFetch
 *   3. 包装为 useXxxQuery / useXxxMutation Hook
 *   4. 在组件中使用 Hook，无需手动管理 loading 状态
 *
 * 命名约定：
 *   - 命名前缀 "example-" 表示此文件仅作演示，
 *     后续接入真实接口后可删除，或按同样规范新建 xxx.api.ts
 *
 * 对接本后端时，新接口可改用 `@/lib/api-client` 的 apiRequest<T>()：
 * 它会自动校验业务码、统一转换错误，并直接返回 data。
 */

import { apiFetch } from '@/lib/api-client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'

import type { ApiResponse } from '../types/response.type'

// ——————————————————————————————————————————————
// 业务数据类型（后续统一放到 @graduation/shared 或模块的 types 文件中）
// ——————————————————————————————————————————————

/** 任务数据结构 */
export interface ITask {
  title: string
  description: string
  status: 'pending' | 'in-progress' | 'completed'
}

// ——————————————————————————————————————————————
// 底层传输层（Transport Layer）
//
// 职责：单一、纯粹地完成 HTTP 请求，不耦合任何 Vue 状态逻辑。
// 优点：可在 Vitest 中脱离 Vue 实例独立进行单元测试。
// ——————————————————————————————————————————————

/** 获取任务列表 */
export async function fetchTasks() {
  return await apiFetch<ApiResponse<ITask[]>>('/tasks', {
    method: 'get',
  })
}

/** 根据 ID 获取单个任务 */
export async function fetchTaskById(id: number) {
  return await apiFetch<ApiResponse<ITask>>(`/tasks/${id}`, {
    method: 'get',
  })
}

/** 更新任务（部分字段） */
export async function updateTask(id: number, data: Partial<ITask>) {
  return await apiFetch<ApiResponse<boolean>>(`/tasks/${id}`, {
    method: 'put',
    body: data,
  })
}

/** 新建任务 */
export async function createTask(data: ITask) {
  return await apiFetch<ApiResponse<ITask>>('/tasks', {
    method: 'post',
    body: data,
  })
}

/** 删除任务 */
export async function deleteTask(id: number) {
  return await apiFetch<ApiResponse<boolean>>(`/tasks/${id}`, {
    method: 'delete',
  })
}

// ——————————————————————————————————————————————
// Vue Query Hooks 层
//
// 职责：将传输函数包装为响应式 Hook，自动管理请求状态与缓存。
// 命名约定：
//   - 查询（GET）：useXxxQuery
//   - 写操作（POST / PUT / DELETE）：useXxxMutation
// ——————————————————————————————————————————————

/**
 * 【查询】获取任务列表。
 *
 * 组件中使用：
 *   const { data, isPending, isError } = useGetTasksQuery()
 */
export function useGetTasksQuery() {
  return useQuery<ApiResponse<ITask[]>, Error>({
    queryKey: ['useGetTasksQuery'],
    queryFn: fetchTasks,
  })
}

/**
 * 【查询】根据 ID 获取单个任务。
 *
 * queryKey 包含 id，当 id 变化时自动重新请求。
 */
export function useGetTaskByIdQuery(id: number) {
  return useQuery<ApiResponse<ITask>, Error>({
    queryKey: ['useGetTaskQuery', id],
    queryFn: () => fetchTaskById(id),
  })
}

/**
 * 【修改】更新任务。
 *
 * 成功后自动使该任务详情及列表缓存失效，触发重新拉取。
 */
export function useUpdateTaskMutation(id: number) {
  const queryClient = useQueryClient()

  return useMutation<ApiResponse<boolean>, Error, Partial<ITask>>({
    mutationKey: ['useUpdateTaskMutation', id],
    mutationFn: (data) => updateTask(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['useGetTaskQuery', id] })
      queryClient.invalidateQueries({ queryKey: ['useGetTasksQuery'] })
    },
  })
}

/**
 * 【创建】新建任务。
 *
 * 成功后使任务列表缓存失效，列表页会自动刷新。
 */
export function useCreateTaskMutation() {
  const queryClient = useQueryClient()

  return useMutation<ApiResponse<ITask>, Error, ITask>({
    mutationKey: ['useCreateTaskMutation'],
    mutationFn: createTask,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['useGetTasksQuery'] })
    },
  })
}

/**
 * 【删除】删除任务。
 *
 * 成功后使任务列表缓存失效，列表页会自动刷新。
 */
export function useDeleteTaskMutation() {
  const queryClient = useQueryClient()

  return useMutation<ApiResponse<boolean>, Error, number>({
    mutationKey: ['useDeleteTaskMutation'],
    mutationFn: deleteTask,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['useGetTasksQuery'] })
    },
  })
}
