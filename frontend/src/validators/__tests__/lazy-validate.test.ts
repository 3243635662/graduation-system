import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { lazyValidate, type FieldValidateContext } from '../lazy-validate'

const schema = z.string().min(1, 'validation.passwordRequired')

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
  const validators = lazyValidate(schema)

  it('未失焦过也不提交时，输入过程不实时报错', () => {
    expect(validators.onChange(context('', { isDirty: true }))).toBeUndefined()
  })

  it('失焦过一次后转为实时校验', () => {
    const issues = validators.onChange(context('', { isDirty: true, isTouched: true }))

    expect(issues).toEqual([expect.objectContaining({ message: 'validation.passwordRequired' })])
  })

  it('没改动过的字段失焦不报错（刚聚焦就点别处）', () => {
    expect(validators.onBlur(context(''))).toBeUndefined()
  })

  it('改动过的字段失焦要校验', () => {
    expect(validators.onBlur(context('', { isDirty: true }))).toHaveLength(1)
    expect(validators.onBlur(context('123', { isDirty: true }))).toEqual([])
  })

  it('提交过一次后，即使没失焦过也实时校验', () => {
    expect(validators.onChange(context('', { isDirty: true }, 1))).toHaveLength(1)
  })

  it('schema 通过后才执行附加校验', () => {
    const withExtra = lazyValidate(schema, (value) =>
      value === 'ok' ? [] : [{ message: 'validation.passwordMismatch' }],
    )

    expect(withExtra.onBlur(context('', { isDirty: true }))).toEqual([
      expect.objectContaining({ message: 'validation.passwordRequired' }),
    ])
    expect(withExtra.onBlur(context('ok', { isDirty: true }))).toEqual([])
    expect(withExtra.onBlur(context('bad', { isDirty: true }))).toEqual([
      expect.objectContaining({ message: 'validation.passwordMismatch' }),
    ])
  })
})
