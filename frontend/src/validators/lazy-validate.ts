import type { z } from 'zod'

/** 校验 issue：只要带 message 就行，message 是 i18n key，由展示层翻译 */
export interface FieldIssue {
  message: string
  path?: readonly PropertyKey[]
}

/** vue-form 字段校验回调里用到的部分上下文 */
export interface FieldValidateContext {
  value: unknown
  fieldApi: {
    state: { meta: { isDirty: boolean; isTouched: boolean } }
    form: { state: { submissionAttempts: number } }
  }
}

type ExtraCheck = (value: unknown, ctx: FieldValidateContext) => FieldIssue[]

/** 执行 schema，把失败结果转成 issue 数组（通过则为空数组） */
export function toIssues(schema: z.ZodType, value: unknown): FieldIssue[] {
  const result = schema.safeParse(value)

  return result.success ? [] : (result.error.issues as FieldIssue[])
}

/** 失焦过，或用户已经尝试提交过，才开始实时校验 */
function isLive(ctx: FieldValidateContext) {
  return ctx.fieldApi.state.meta.isTouched || ctx.fieldApi.form.state.submissionAttempts > 0
}

/**
 * 惰性字段校验：不在用户还没开始填的时候打扰他
 *
 * - 改动之前不实时校验：只是聚焦、打字的过程不会立刻飘红；
 * - 没改动过的字段失焦也不校验：点一下输入框再点别处不会提示「未输入」；
 * - 失焦过（或提交过一次）之后转为实时校验，改的过程中就能看到结果。
 *
 * @param schema 该字段的校验规则
 * @param extra 附加校验（如「两次密码是否一致」），schema 通过后才执行
 */
export function lazyValidate(schema: z.ZodType, extra?: ExtraCheck) {
  const check = (ctx: FieldValidateContext): FieldIssue[] => {
    const issues = toIssues(schema, ctx.value)

    return issues.length > 0 ? issues : (extra?.(ctx.value, ctx) ?? [])
  }

  return {
    onChange: (ctx: FieldValidateContext) => (isLive(ctx) ? check(ctx) : undefined),
    onBlur: (ctx: FieldValidateContext) =>
      ctx.fieldApi.state.meta.isDirty ? check(ctx) : undefined,
  }
}
