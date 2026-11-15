import { z } from 'zod'

/**
 * 管理后台表单校验（中文提示，直接展示）
 *
 * 与 auth 表单不同，这里的提示不需要多语言切换，
 * 因此 message 直接写中文文案，省去一层 key 映射。
 *
 * 校验原则：没输入时不报错（除非字段必填），只针对单个字段提示。
 */
const requiredText = (message: string, max: number, maxMessage: string) =>
  z.string().trim().min(1, message).max(max, maxMessage)

const optionalText = (max: number, maxMessage: string) => z.string().trim().max(max, maxMessage)

const optionalYear = z
  .string()
  .trim()
  .refine((value) => value === '' || /^\d{4}$/.test(value), { message: '入学年份应为 4 位数字' })

/** 新建学生档案 */
export const studentCreateSchema = z.object({
  userId: z.string().min(1, '请选择要绑定档案的学生账号'),
  studentNo: requiredText('请输入学号', 32, '学号最多 32 个字符'),
  classId: z.string(),
  enrollmentYear: optionalYear,
})

/** 修改学生档案（学号、入学年份） */
export const studentEditSchema = z.object({
  studentNo: requiredText('请输入学号', 32, '学号最多 32 个字符'),
  enrollmentYear: optionalYear,
})

/** 首次分班 / 转班 */
export const studentTransferSchema = z.object({
  targetClassId: z.string().min(1, '请选择目标班级'),
  reason: requiredText('请填写分班或转班原因', 255, '原因不能超过 255 个字符'),
})

/** 新建工作人员档案 */
export const personnelCreateSchema = z.object({
  userId: z.string().min(1, '请选择要绑定档案的账号'),
  employeeNo: optionalText(32, '工号最多 32 个字符'),
  primaryOrganizationUnitId: z.string().min(1, '请选择正式组织归属'),
  positionName: optionalText(64, '岗位名称最多 64 个字符'),
})

/** 修改工作人员档案 */
export const personnelEditSchema = z.object({
  employeeNo: optionalText(32, '工号最多 32 个字符'),
  positionName: optionalText(64, '岗位名称最多 64 个字符'),
  primaryOrganizationUnitId: z.string().min(1, '请选择正式组织归属'),
})

/** 把工作人员提升为教师 */
export const teacherCreateSchema = z.object({
  personnelProfileId: z.string().min(1, '请选择工作人员'),
  teacherNo: requiredText('请输入教师编号', 32, '教师编号最多 32 个字符'),
  title: optionalText(64, '职称最多 64 个字符'),
})

/** 修改教师档案 */
export const teacherEditSchema = z.object({
  teacherNo: requiredText('请输入教师编号', 32, '教师编号最多 32 个字符'),
  title: optionalText(64, '职称最多 64 个字符'),
})

/** 分配角色 */
export const roleAssignmentSchema = z
  .object({
    roleCode: z.string().min(1, '请选择角色'),
    scopeOrgUnitId: z.string(),
    validUntil: z.string(),
  })
  .refine((value) => value.validUntil === '' || !Number.isNaN(Date.parse(value.validUntil)), {
    message: '请选择合法的失效时间',
    path: ['validUntil'],
  })

/** 新建组织节点 */
export const organizationCreateSchema = z.object({
  name: requiredText('请输入组织名称', 100, '组织名称最多 100 个字符'),
  code: z
    .string()
    .trim()
    .min(1, '请输入组织编码')
    .max(64, '组织编码最多 64 个字符')
    .regex(/^[A-Za-z0-9_-]+$/, '组织编码只能包含字母、数字、下划线和短横线'),
  type: z.enum(['DEPARTMENT', 'MAJOR', 'CLASS']),
  sortOrder: z
    .string()
    .trim()
    .refine((value) => value === '' || /^\d{1,4}$/.test(value), {
      message: '排序应为 0-9999 的整数',
    }),
})

/** 修改组织节点 */
export const organizationUpdateSchema = z.object({
  name: requiredText('请输入组织名称', 100, '组织名称最多 100 个字符'),
  sortOrder: z
    .string()
    .trim()
    .refine((value) => value === '' || /^\d{1,4}$/.test(value), {
      message: '排序应为 0-9999 的整数',
    }),
})

/**
 * 取第一条错误信息
 *
 * 表单是「提交时整体校验」，因此只需要把第一处问题提示给用户，
 * 避免一屏红字。
 */
export function firstIssueMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? '请检查填写内容'
}

/** 把 '2024' 这样的年份字符串转成数字，空串转 null */
export function toYearOrNull(value: string): number | null {
  const trimmed = value.trim()

  return trimmed === '' ? null : Number(trimmed)
}

/** 把空的文本字段转成 undefined，避免把空串提交给后端 */
export function toOptionalText(value: string): string | undefined {
  const trimmed = value.trim()

  return trimmed === '' ? undefined : trimmed
}
