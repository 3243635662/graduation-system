import { ref } from 'vue'
import { toast } from 'vue-sonner'

export interface SubmitActionOptions {
  /** 成功提示文案，留空则不提示 */
  success?: string
  /** 成功后的副作用（关闭弹窗、刷新列表等） */
  onSuccess?: () => void | Promise<void>
}

/**
 * 表单/操作提交的统一反馈
 *
 * - 提交期间把 `submitting` 置为 true，用于禁用按钮，避免重复提交；
 * - 成功走 toast + 可选副作用；
 * - 失败直接把后端错误信息展示出来（ApiError.message 已经是中文可读文案）。
 */
export function useSubmitAction() {
  const submitting = ref(false)

  async function submit(
    task: () => Promise<unknown>,
    options: SubmitActionOptions = {},
  ): Promise<boolean> {
    if (submitting.value) return false

    submitting.value = true

    try {
      await task()

      if (options.success) toast.success(options.success)
      await options.onSuccess?.()

      return true
    } catch (rawError) {
      toast.error(
        rawError instanceof Error && rawError.message ? rawError.message : '操作失败，请稍后重试',
      )

      return false
    } finally {
      submitting.value = false
    }
  }

  return { submitting, submit }
}
