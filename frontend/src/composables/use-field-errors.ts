import { useI18n } from 'vue-i18n'

/** 表单项错误的两种形态：纯文本，或 Standard Schema 的 issue */
export type FieldErrorItem = string | { message?: string } | undefined

/**
 * 翻译表单校验错误
 *
 * Schema 里的 message 存的是 i18n key（见 `validators/auth.schema.ts`），
 * 展示前统一翻译，切换语言时已显示的报错会同步切换。
 * 若 message 不是已知 key（例如后端返回的原文），i18n 会原样返回，不会丢信息。
 */
export function useFieldErrors() {
  const { t } = useI18n()

  return function translateErrors(errors: readonly FieldErrorItem[] | undefined): string[] {
    if (!errors || errors.length === 0) return []

    return errors.flatMap((error) => {
      const message = typeof error === 'string' ? error : error?.message

      return message ? [t(message)] : []
    })
  }
}
