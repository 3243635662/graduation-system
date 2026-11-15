import 'dotenv/config'
import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import * as argon2 from 'argon2'

import { PrismaClient } from '../generated/prisma/client.js'

/**
 * 本地开发用演示数据
 *
 * 与 prisma/seed.ts 分离：
 * - 正式 Seed 只维护学校根节点、角色、权限、菜单与学校管理员；
 * - 本脚本必须显式确认后才执行，只用于本地开发/联调；
 * - 幂等：已存在的组织/账号/档案不覆盖管理员维护过的值；
 * - 不删除、不停用任何已有组织、用户或角色分配。
 *
 * 生成内容：
 * - 2 个院系 / 3 个专业 / 4 个班级
 * - 3 名学生（含 1 名未分班）
 * - 2 名教师（含 1 个班主任任职）
 * - 1 名辅导员（1 个班级分配）
 */

if (process.env['DEV_SEED_CONFIRM'] !== 'true') {
  throw new Error(
    '拒绝执行：这是开发演示数据脚本。请显式设置 DEV_SEED_CONFIRM=true 后再运行（pnpm --filter backend seed:dev-org）。',
  )
}

const databaseUrl = process.env['DATABASE_URL']

if (!databaseUrl) {
  throw new Error('缺少 DATABASE_URL 环境变量')
}

const devPassword = process.env['DEV_SEED_PASSWORD']?.trim() ?? ''

if (devPassword.length < 8) {
  throw new Error('缺少 DEV_SEED_PASSWORD（至少 8 位），用于演示账号的初始密码')
}

interface DevOrgNode {
  code: string
  name: string
  type: 'DEPARTMENT' | 'MAJOR' | 'CLASS'
  parentCode: string
  sortOrder: number
}

/**
 * 演示组织树
 *
 * 示范大学（既有根节点）
 * ├── 计算机学院
 * │   ├── 软件工程
 * │   │   ├── 软件工程一班
 * │   │   └── 软件工程二班
 * │   └── 计算机科学与技术
 * │       └── 计算机一班
 * └── 经济管理学院
 *     └── 工商管理
 *         └── 工商管理一班
 */
const DEV_ORG_TREE: readonly DevOrgNode[] = [
  { code: 'CS', name: '计算机学院', type: 'DEPARTMENT', parentCode: 'SCHOOL-ROOT', sortOrder: 1 },
  { code: 'SE', name: '软件工程', type: 'MAJOR', parentCode: 'CS', sortOrder: 1 },
  { code: 'SE-2401', name: '软件工程一班', type: 'CLASS', parentCode: 'SE', sortOrder: 1 },
  { code: 'SE-2402', name: '软件工程二班', type: 'CLASS', parentCode: 'SE', sortOrder: 2 },
  { code: 'CSE', name: '计算机科学与技术', type: 'MAJOR', parentCode: 'CS', sortOrder: 2 },
  { code: 'CSE-2401', name: '计算机一班', type: 'CLASS', parentCode: 'CSE', sortOrder: 1 },
  {
    code: 'ECON',
    name: '经济管理学院',
    type: 'DEPARTMENT',
    parentCode: 'SCHOOL-ROOT',
    sortOrder: 2,
  },
  { code: 'BA', name: '工商管理', type: 'MAJOR', parentCode: 'ECON', sortOrder: 1 },
  { code: 'BA-2401', name: '工商管理一班', type: 'CLASS', parentCode: 'BA', sortOrder: 1 },
]

interface DevStudent {
  email: string
  realName: string
  studentNo: string
  classCode: string | null
  enrollmentYear: number
}

const DEV_STUDENTS: readonly DevStudent[] = [
  {
    email: 'student001@demo.local',
    realName: '张小明',
    studentNo: '2021001001',
    classCode: 'SE-2401',
    enrollmentYear: 2021,
  },
  {
    email: 'student002@demo.local',
    realName: '李思思',
    studentNo: '2021001002',
    classCode: 'SE-2402',
    enrollmentYear: 2021,
  },
  {
    email: 'student003@demo.local',
    realName: '王未分',
    studentNo: '2021001003',
    classCode: null,
    enrollmentYear: 2022,
  },
]

interface DevStaff {
  email: string
  realName: string
  employeeNo: string
  positionName: string
  organizationCode: string
  teacher?: {
    teacherNo: string
    title: string
  }
  headTeacherClassCode?: string
  counselorClassCodes?: string[]
}

const DEV_STAFF: readonly DevStaff[] = [
  {
    email: 'teacher001@demo.local',
    realName: '陈导师',
    employeeNo: 'T0001',
    positionName: '副教授',
    organizationCode: 'CS',
    teacher: { teacherNo: 'T2021001', title: '副教授' },
    headTeacherClassCode: 'SE-2401',
  },
  {
    email: 'teacher002@demo.local',
    realName: '刘老师',
    employeeNo: 'T0002',
    positionName: '讲师',
    organizationCode: 'CSE',
    teacher: { teacherNo: 'T2021002', title: '讲师' },
  },
  {
    email: 'counselor001@demo.local',
    realName: '赵辅导',
    employeeNo: 'C0001',
    positionName: '辅导员',
    organizationCode: 'CS',
    counselorClassCodes: ['SE-2402'],
  },
]

const prisma = new PrismaClient({
  adapter: new PrismaMariaDb(databaseUrl),
})

async function main() {
  const root = await prisma.organizationUnit.findFirst({
    where: { type: 'SCHOOL' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, code: true, name: true, status: true },
  })

  if (!root) {
    throw new Error(
      '未找到学校根节点，请先执行正式 Seed（pnpm --filter backend exec prisma db seed）',
    )
  }

  console.log(`学校根节点：${root.name}（${root.code}），状态 ${root.status}`)

  const roleIdByCode = new Map(
    (await prisma.role.findMany({ select: { id: true, code: true } })).map((role) => [
      role.code,
      role.id,
    ]),
  )

  for (const code of ['STUDENT', 'TEACHER', 'CLASS_COORDINATOR']) {
    if (!roleIdByCode.has(code)) {
      throw new Error(`角色 ${code} 未初始化，请先执行正式 Seed`)
    }
  }

  const idByCode = new Map<string, string>([
    [root.code, root.id],
    ['SCHOOL-ROOT', root.id],
  ])

  const summary = await prisma.$transaction(
    async (tx) => {
      let organizationCreated = 0
      let organizationExisting = 0

      for (const node of DEV_ORG_TREE) {
        const parentId = idByCode.get(node.parentCode)

        if (!parentId) {
          throw new Error(`父节点 ${node.parentCode} 尚未创建，请检查节点顺序`)
        }

        const current = await tx.organizationUnit.findUnique({
          where: { code: node.code },
          select: { id: true, type: true, parentId: true },
        })

        if (current) {
          if (current.type !== node.type || current.parentId !== parentId) {
            throw new Error(
              `组织编码 ${node.code} 已存在但结构不一致：` +
                `type=${current.type}（期望 ${node.type}），parentId=${current.parentId ?? 'null'}（期望 ${parentId}）。` +
                '为避免破坏现有数据，脚本已中止且未做任何修改。',
            )
          }

          organizationExisting += 1
          idByCode.set(node.code, current.id)

          continue
        }

        const record = await tx.organizationUnit.create({
          data: {
            code: node.code,
            name: node.name,
            type: node.type,
            parentId,
            sortOrder: node.sortOrder,
            status: 'ACTIVE',
          },
          select: { id: true },
        })

        organizationCreated += 1
        idByCode.set(node.code, record.id)
      }

      const passwordHash = await argon2.hash(devPassword, { type: argon2.argon2id })

      const ensureUser = async (email: string, realName: string) => {
        const existed = await tx.user.findUnique({ where: { email }, select: { id: true } })

        if (existed) return { id: existed.id, created: false }

        const created = await tx.user.create({
          data: {
            email,
            passwordHash,
            realName,
            emailVerifiedAt: new Date(),
            status: 'ACTIVE',
          },
          select: { id: true },
        })

        return { id: created.id, created: true }
      }

      const assignRole = async (
        userId: string,
        roleCode: string,
        scopeKey: string,
        scopeOrgUnitId: string | null,
      ) => {
        const roleId = roleIdByCode.get(roleCode)!

        const existing = await tx.userRole.findUnique({
          where: { userId_roleId_scopeKey: { userId, roleId, scopeKey } },
          select: { id: true },
        })

        if (existing) return false

        await tx.userRole.create({
          data: {
            userId,
            roleId,
            scopeKey,
            scopeOrgUnitId,
          },
        })

        return true
      }

      let studentCreated = 0
      let studentExisting = 0
      let roleAssigned = 0

      for (const student of DEV_STUDENTS) {
        const user = await ensureUser(student.email, student.realName)

        if (user.created) studentCreated += 1
        else studentExisting += 1

        const classId = student.classCode ? (idByCode.get(student.classCode) ?? null) : null

        await tx.studentProfile.upsert({
          where: { userId: user.id },
          create: {
            userId: user.id,
            studentNo: student.studentNo,
            classId,
            enrollmentYear: student.enrollmentYear,
          },
          update: {},
        })

        if (await assignRole(user.id, 'STUDENT', 'GLOBAL', null)) roleAssigned += 1
      }

      let staffCreated = 0
      let staffExisting = 0
      let teacherCreated = 0
      let dutyCreated = 0

      for (const staff of DEV_STAFF) {
        const user = await ensureUser(staff.email, staff.realName)

        if (user.created) staffCreated += 1
        else staffExisting += 1

        const organizationId = idByCode.get(staff.organizationCode)

        if (!organizationId) {
          throw new Error(`组织 ${staff.organizationCode} 不存在，无法创建工作人员档案`)
        }

        const personnel = await tx.personnelProfile.upsert({
          where: { userId: user.id },
          create: {
            userId: user.id,
            employeeNo: staff.employeeNo,
            primaryOrganizationUnitId: organizationId,
            positionName: staff.positionName,
          },
          update: {},
          select: { id: true },
        })

        if (staff.teacher) {
          const existedTeacher = await tx.teacherProfile.findUnique({
            where: { personnelProfileId: personnel.id },
            select: { id: true },
          })

          const teacher =
            existedTeacher ??
            (await tx.teacherProfile.create({
              data: {
                personnelProfileId: personnel.id,
                teacherNo: staff.teacher.teacherNo,
                title: staff.teacher.title,
              },
              select: { id: true },
            }))

          if (!existedTeacher) teacherCreated += 1

          if (await assignRole(user.id, 'TEACHER', 'GLOBAL', null)) roleAssigned += 1

          if (staff.headTeacherClassCode) {
            const classId = idByCode.get(staff.headTeacherClassCode)

            if (!classId) {
              throw new Error(`班级 ${staff.headTeacherClassCode} 不存在`)
            }

            const existingDuty = await tx.teacherClassDuty.findFirst({
              where: { teacherId: teacher.id, classId, revokedAt: null },
              select: { id: true },
            })

            if (!existingDuty) {
              await tx.teacherClassDuty.create({
                data: {
                  teacherId: teacher.id,
                  classId,
                  assignedById: user.id,
                  createdById: user.id,
                },
              })

              dutyCreated += 1
            }
          }
        }

        for (const classCode of staff.counselorClassCodes ?? []) {
          const classId = idByCode.get(classCode)

          if (!classId) {
            throw new Error(`班级 ${classCode} 不存在`)
          }

          const existing = await tx.counselorClassAssignment.findFirst({
            where: { userId: user.id, classId, revokedAt: null },
            select: { id: true },
          })

          if (!existing) {
            await tx.counselorClassAssignment.create({
              data: {
                userId: user.id,
                classId,
                assignedById: user.id,
                createdById: user.id,
              },
            })
          }

          if (await assignRole(user.id, 'CLASS_COORDINATOR', classId, classId)) roleAssigned += 1
        }
      }

      return {
        organizationCreated,
        organizationExisting,
        studentCreated,
        studentExisting,
        staffCreated,
        staffExisting,
        teacherCreated,
        dutyCreated,
        roleAssigned,
      }
    },
    { maxWait: 10_000, timeout: 30_000 },
  )

  console.log(
    `演示组织：新增 ${summary.organizationCreated} 个，已存在 ${summary.organizationExisting} 个`,
  )
  console.log(
    `演示学生账号：新增 ${summary.studentCreated} 个，已存在 ${summary.studentExisting} 个`,
  )
  console.log(
    `演示工作人员账号：新增 ${summary.staffCreated} 个，已存在 ${summary.staffExisting} 个`,
  )
  console.log(`演示教师身份：新增 ${summary.teacherCreated} 个`)
  console.log(`演示班主任任职：新增 ${summary.dutyCreated} 条`)
  console.log(`角色分配：新增 ${summary.roleAssigned} 条`)
  console.log('演示账号初始密码来自 DEV_SEED_PASSWORD，未在日志中输出。')
  console.log('未删除或停用任何既有组织、用户与角色分配。')
}

main()
  .catch((error: unknown) => {
    console.error('开发演示 Seed 失败：', error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
