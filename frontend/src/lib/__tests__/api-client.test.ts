import { API_ERROR_CODE } from '@/services/types/response.type'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.hoisted(() => vi.fn())
vi.mock('ofetch', () => ({ ofetch: { create: () => fetchMock } }))

const emitRefreshed = vi.hoisted(() => vi.fn())
const emitExpired = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth-events', () => ({
  emitSessionRefreshed: emitRefreshed,
  emitSessionExpired: emitExpired,
  onSessionRefreshed: vi.fn(),
  onSessionExpired: vi.fn(),
}))

vi.mock('@/constants/app-config', () => ({
  API_BASE_URL: 'https://example.test/api',
  API_TIMEOUT: 5000,
}))

import { getAccessToken, setAccessToken } from '@/lib/access-token'
import { apiRequest } from '@/lib/api-client'

const user = {
  id: 'user-1',
  email: 'student@example.com',
  displayName: '张三',
  status: 'ACTIVE' as const,
  roles: [],
}

function success<T>(data: T) {
  return { code: 0, data, message: '请求成功' }
}

function httpError(code: number, message: string, status: number) {
  return Object.assign(new Error(message), {
    status,
    data: { code, data: null, message },
  })
}

describe('apiRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setAccessToken(null)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('成功响应直接返回 data', async () => {
    fetchMock.mockResolvedValueOnce(success({ ok: true }))

    await expect(apiRequest('/tasks')).resolves.toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('Access Token 过期时刷新、落地新 Token 并重试一次', async () => {
    fetchMock
      .mockRejectedValueOnce(httpError(API_ERROR_CODE.TOKEN_EXPIRED, '登录凭证已过期', 401))
      .mockResolvedValueOnce(success({ accessToken: 'new-token', user }))
      .mockResolvedValueOnce(success({ ok: true }))

    await expect(apiRequest('/tasks')).resolves.toEqual({ ok: true })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/auth/refresh', { method: 'POST' })
    expect(getAccessToken()).toBe('new-token')
    expect(emitRefreshed).toHaveBeenCalledWith({ accessToken: 'new-token', user })
  })

  it('并发 401 只触发一次刷新', async () => {
    let refreshCalls = 0
    let taskCalls = 0

    fetchMock.mockImplementation((path: string) => {
      if (path === '/auth/refresh') {
        refreshCalls += 1
        return Promise.resolve(success({ accessToken: 'new-token', user }))
      }

      taskCalls += 1

      if (taskCalls <= 2) {
        return Promise.reject(httpError(API_ERROR_CODE.TOKEN_EXPIRED, '过期', 401))
      }

      return Promise.resolve(success({ ok: true }))
    })

    const results = await Promise.all([apiRequest('/tasks/1'), apiRequest('/tasks/2')])

    expect(results).toEqual([{ ok: true }, { ok: true }])
    expect(refreshCalls).toBe(1)
    expect(emitRefreshed).toHaveBeenCalledOnce()
  })

  it('刷新失败时清空 Token 并通知组合根处理过期', async () => {
    fetchMock
      .mockRejectedValueOnce(httpError(API_ERROR_CODE.TOKEN_EXPIRED, '过期', 401))
      .mockRejectedValueOnce(httpError(API_ERROR_CODE.REFRESH_TOKEN_INVALID, '刷新令牌无效', 401))

    // 刷新失败后向上抛出的是原始请求错误（40101）
    await expect(apiRequest('/tasks')).rejects.toMatchObject({
      code: API_ERROR_CODE.TOKEN_EXPIRED,
    })

    expect(getAccessToken()).toBeNull()
    expect(emitExpired).toHaveBeenCalledOnce()
  })

  it('登录失败（40100）不触发刷新与过期处理', async () => {
    fetchMock.mockRejectedValueOnce(httpError(API_ERROR_CODE.UNAUTHORIZED, '邮箱或密码错误', 401))

    await expect(
      apiRequest('/auth/login', { method: 'POST', body: { email: 'a@b.com' } }),
    ).rejects.toMatchObject({ code: API_ERROR_CODE.UNAUTHORIZED })

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(emitExpired).not.toHaveBeenCalled()
  })

  it('Refresh 接口自身失败不会再次刷新（避免无限循环）', async () => {
    fetchMock.mockRejectedValueOnce(
      httpError(API_ERROR_CODE.REFRESH_TOKEN_INVALID, '刷新令牌无效', 401),
    )

    await expect(apiRequest('/auth/refresh', { method: 'POST' })).rejects.toMatchObject({
      code: API_ERROR_CODE.REFRESH_TOKEN_INVALID,
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(emitExpired).not.toHaveBeenCalled()
  })

  it('跨标签页刷新通过 Web Locks 串行化', async () => {
    const lockRequest = vi.fn((_name: string, callback: () => Promise<unknown>) => callback())

    vi.stubGlobal('navigator', { locks: { request: lockRequest } })

    fetchMock
      .mockRejectedValueOnce(httpError(API_ERROR_CODE.TOKEN_EXPIRED, '过期', 401))
      .mockResolvedValueOnce(success({ accessToken: 'new-token', user }))
      .mockResolvedValueOnce(success({ ok: true }))

    await expect(apiRequest('/tasks')).resolves.toEqual({ ok: true })

    expect(lockRequest).toHaveBeenCalledWith('graduation:auth-refresh', expect.any(Function))
  })

  it('重试后仍然过期则不再刷新', async () => {
    fetchMock
      .mockRejectedValueOnce(httpError(API_ERROR_CODE.TOKEN_EXPIRED, '过期', 401))
      .mockResolvedValueOnce(success({ accessToken: 'new-token', user }))
      .mockRejectedValueOnce(httpError(API_ERROR_CODE.TOKEN_EXPIRED, '又过期', 401))

    await expect(apiRequest('/tasks')).rejects.toMatchObject({
      code: API_ERROR_CODE.TOKEN_EXPIRED,
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(emitExpired).not.toHaveBeenCalled()
  })
})
