import { z } from 'zod'

/**
 * 登录 Schema
 *
 * identifier 支持三种稳定标识：
 * - 邮箱（含 @，按邮箱查询）
 * - 学号（学生档案）
 * - 工号（教师档案或工作人员档案）
 *
 * 只校验输入格式，不暴露「账号是否存在」等业务信息。
 */
export const loginSchema = z.object({
  identifier: z
    .string()
    .trim()
    .min(1, '请输入邮箱、学号或工号')
    .max(191, '登录标识不能超过 191 个字符'),
  password: z.string().min(1, '请输入密码'),
})

export type LoginInput = z.infer<typeof loginSchema>
