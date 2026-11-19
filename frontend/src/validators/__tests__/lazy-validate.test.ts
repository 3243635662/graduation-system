import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { lazyValidate, type FieldValidateContext } from '../lazy-validate'

const requiredSchema = z.string().min(1, 'validation.passwordRequired')
const minLengthSchema = z.string().min(3, 'validation.passwordMin')

function context(
  value: unknown,
  meta: { isDirty?: boolean; isTouched?: boolean } = {},
  submissionAttempts = 0,
): FieldValidateContext {
  return {
    value,
    fieldApi: {
      state: {
        meta: {
          isDirty: meta.isDirty ?? false,
          isTouched: meta.isTouched ?? false,
        },
      },
      form: { state: { submissionAttempts } },
    },
  }
}

describe('lazyValidate', () => {
  const validators = lazyValidate(requiredSchema)

  it('内容为空时不显示「必填」错误', () => {
    expect(validators.onChange(context('', { isDirty: true }))).toEqual([])
  })

  it('非空但未失焦、未提交时不实时报错', () => {
    const strict = lazyValidate(minLengthSchema)

    expect(strict.onChange(context('ab', { isDirty: true }))).toBeUndefined()
  })

  it('输入到合法值后立即清除已有错误，不必等到失焦', () => {
    expect(validators.onChange(context('123', { isDirty: true }))).toEqual([])
  })

  it('清空内容时立即清除旧错误，不沿用之前那条消息', () => {
    const strict = lazyValidate(minLengthSchema)

    expect(strict.onChange(context('', { isDirty: true, isTouched: true }))).toEqual([])
  })

  it('清空后失焦也不提示必填，交给提交时的整表校验兜底', () => {
    expect(validators.onBlur(context('', { isDirty: true }))).toEqual([])
  })

  it('失焦过一次后，非空非法值实时报错', () => {
    const strict = lazyValidate(minLengthSchema)

    expect(strict.onChange(context('ab', { isDirty: true, isTouched: true }))).toEqual([
      expect.objectContaining({ message: 'validation.passwordMin' }),
    ])
  })

  it('没改动过的字段失焦不校验（刚聚焦就点别处）', () => {
    const strict = lazyValidate(minLengthSchema)

    // 非空非法，但没有改动过：不产生新错误
    expect(strict.onBlur(context('ab'))).toBeUndefined()
    // 空值：直接清除，不提示必填
    expect(validators.onBlur(context(''))).toEqual([])
  })

  it('改动过的字段失焦要校验非空非法值', () => {
    const strict = lazyValidate(minLengthSchema)

    expect(strict.onBlur(context('ab', { isDirty: true }))).toEqual([
      expect.objectContaining({ message: 'validation.passwordMin' }),
    ])
    expect(strict.onBlur(context('abc', { isDirty: true }))).toEqual([])
  })

  it('提交过一次后，即使没失焦过也对非空非法值实时校验', () => {
    const strict = lazyValidate(minLengthSchema)

    expect(strict.onChange(context('ab', { isDirty: true }, 1))).toHaveLength(1)
  })

  it('schema 通过后才执行附加校验', () => {
    const withExtra = lazyValidate(requiredSchema, (value) =>
      value === 'ok' ? [] : [{ message: 'validation.passwordMismatch' }],
    )
    const strictWithExtra = lazyValidate(minLengthSchema, () => [
      { message: 'validation.passwordMismatch' },
    ])

    // schema 未通过时只返回 schema 的错误
    expect(strictWithExtra.onBlur(context('ab', { isDirty: true }))).toEqual([
      expect.objectContaining({ message: 'validation.passwordMin' }),
    ])

    expect(withExtra.onBlur(context('ok', { isDirty: true }))).toEqual([])
    expect(withExtra.onBlur(context('bad', { isDirty: true }))).toEqual([
      expect.objectContaining({ message: 'validation.passwordMismatch' }),
    ])
  })
})
