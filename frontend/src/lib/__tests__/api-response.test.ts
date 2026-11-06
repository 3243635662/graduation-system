import { ApiError, toApiError, unwrapApiResponse } from '@/lib/api-response'
import { API_ERROR_CODE, API_SUCCESS_CODE } from '@/services/types/response.type'
import { describe, expect, it } from 'vitest'

describe('api-response', () => {
  it('解包成功响应的 data', () => {
    expect(
      unwrapApiResponse({
        code: API_SUCCESS_CODE,
        data: { id: 'user-001' },
        message: '请求成功',
      }),
    ).toEqual({ id: 'user-001' })
  })

  it('业务码非 0 时抛出 ApiError', () => {
    expect(() =>
      unwrapApiResponse({
        code: API_ERROR_CODE.NOT_FOUND,
        data: null,
        message: '请求的数据不存在',
      }),
    ).toThrowError(ApiError)
  })

  it('保留 Zod 校验错误的字段详情', () => {
    const issues = [{ path: 'page', message: 'Too small' }]

    expect.assertions(2)
    try {
      unwrapApiResponse({
        code: API_ERROR_CODE.VALIDATION_FAILED,
        data: issues,
        message: '请求参数校验失败',
      })
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError)
      expect((error as ApiError).issues).toEqual(issues)
    }
  })

  it('成功但 data 为 null 时抛出 ApiError', () => {
    expect(() =>
      unwrapApiResponse({
        code: API_SUCCESS_CODE,
        data: null,
        message: '请求成功',
      }),
    ).toThrowError('响应数据为空')
  })

  it('把后端 HTTP 错误体转换为 ApiError', () => {
    const fetchError = Object.assign(new Error('Bad Request'), {
      status: 400,
      data: {
        code: API_ERROR_CODE.VALIDATION_FAILED,
        data: [{ path: 'page', message: 'Too small' }],
        message: '请求参数校验失败',
      },
    })

    const result = toApiError(fetchError)
    expect(result).toBeInstanceOf(ApiError)
    expect((result as ApiError).code).toBe(API_ERROR_CODE.VALIDATION_FAILED)
    expect((result as ApiError).status).toBe(400)
    expect((result as ApiError).message).toBe('请求参数校验失败')
  })

  it('非后端格式的错误保持原样', () => {
    const error = new Error('network error')
    expect(toApiError(error)).toBe(error)
  })
})
