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
 * 内容为空。
 *
 * 用户把内容删掉时，之前那条「至少 8 位」「格式不正确」之类的错误
 * 已经不适用于当前输入，必须立即清除，不能留到失焦或提交才更新。
 */
function isEmptyValue(value: unknown): boolean {
  return value === '' || value === null || value === undefined
}

/**
 * 惰性字段校验：不在用户还没开始填的时候打扰他
 *
 * - 改动之前不实时校验：只是聚焦、打字的过程不会立刻飘红；
 * - 没改动过的字段失焦也不校验：点一下输入框再点别处不会提示「未输入」；
 * - 失焦过（或提交过一次）之后转为实时校验，改的过程中就能看到结果。
 *
 * 关键约定：**校验通过时永远立即清除错误**。
 *
 * TanStack Form 里校验器返回 undefined 表示「本次不更新校验结果」，
 * 并不会清掉之前显示的错误；如果只在 live 阶段才返回结果，
 * 用户把密码补到合法长度后仍会一直看到「至少 8 位」，
 * 直到再次失焦才消失。因此这里把「通过」与「失败」分开处理：
 * - 通过 → 返回空数组，立即清除；
 * - 失败 → 只有 live 阶段才返回，避免边打字边飘红。
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
    onChange: (ctx: FieldValidateContext) => {
      // 内容被清空：旧错误已不适用，立即清除，不等失焦也不显示「必填」
      if (isEmptyValue(ctx.value)) return []

      const issues = check(ctx)

      // 已经合法：无论是否失焦过都立即清除，避免「补够了还一直红」
      if (issues.length === 0) return []

      // 仍不合法：只在失焦过或提交过之后提示
      return isLive(ctx) ? issues : undefined
    },
    onBlur: (ctx: FieldValidateContext) => {
      // 清空后离开输入框同样不提示必填，交给提交时的整表校验兜底
      if (isEmptyValue(ctx.value)) return []

      return ctx.fieldApi.state.meta.isDirty ? check(ctx) : undefined
    },
  }
}
