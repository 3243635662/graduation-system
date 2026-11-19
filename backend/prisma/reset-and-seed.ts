import 'dotenv/config'
import { execFileSync } from 'node:child_process'

import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import * as argon2 from 'argon2'

import { PrismaClient } from '../generated/prisma/client.js'

/**
 * 本地演示环境重置并初始化。
 *
 * 该脚本会删除所有业务、权限、组织和审计数据，只保留 .env 中
 * SUPER_ADMIN_EMAIL 指定的一个学校管理员账号，然后重新创建系统基础数据
 * 和一套彼此关联的演示组织、人员与学生数据。
 */

if (process.env['RESET_DEMO_DATA_CONFIRM'] !== 'true') {
  throw new Error(
    '拒绝执行：该脚本会清空数据库。请显式设置 RESET_DEMO_DATA_CONFIRM=true 后再运行。',
  )
}

const databaseUrl = process.env['DATABASE_URL']
const superAdminEmail = process.env['SUPER_ADMIN_EMAIL']?.trim()

if (!databaseUrl || !superAdminEmail) {
  throw new Error('缺少 DATABASE_URL 或 SUPER_ADMIN_EMAIL 环境变量')
}

/** 演示账号密码可通过环境变量覆盖；仅限本地、已显式确认的重置流程。 */
const demoPassword = process.env['RESET_DEMO_PASSWORD']?.trim() || 'Demo@2026'

if (demoPassword.length < 8) {
  throw new Error('RESET_DEMO_PASSWORD 至少需要 8 位')
}

const prisma = new PrismaClient({
  adapter: new PrismaMariaDb(databaseUrl),
})

interface OrgNode {
  code: string
  name: string
  type: 'DEPARTMENT' | 'MAJOR' | 'CLASS'
  parentCode: string
  sortOrder: number
}

const ORG_TREE: readonly OrgNode[] = [
  { code: 'CS', name: '计算机学院', type: 'DEPARTMENT', parentCode: 'SCHOOL-ROOT', sortOrder: 1 },
  { code: 'SE', name: '软件工程', type: 'MAJOR', parentCode: 'CS', sortOrder: 1 },
  { code: 'SE-2301', name: '软件工程 2301 班', type: 'CLASS', parentCode: 'SE', sortOrder: 1 },
  { code: 'SE-2302', name: '软件工程 2302 班', type: 'CLASS', parentCode: 'SE', sortOrder: 2 },
  { code: 'CSE', name: '计算机科学与技术', type: 'MAJOR', parentCode: 'CS', sortOrder: 2 },
  {
    code: 'CSE-2301',
    name: '计算机科学与技术 2301 班',
    type: 'CLASS',
    parentCode: 'CSE',
    sortOrder: 1,
  },
  { code: 'MGT', name: '管理学院', type: 'DEPARTMENT', parentCode: 'SCHOOL-ROOT', sortOrder: 2 },
  { code: 'BA', name: '工商管理', type: 'MAJOR', parentCode: 'MGT', sortOrder: 1 },
  { code: 'BA-2301', name: '工商管理 2301 班', type: 'CLASS', parentCode: 'BA', sortOrder: 1 },
  { code: 'BA-2302', name: '工商管理 2302 班', type: 'CLASS', parentCode: 'BA', sortOrder: 2 },
]

interface StudentSeed {
  email: string
  realName: string
  studentNo: string
  classCode: string
  coordinator?: boolean
}

const STUDENTS: readonly StudentSeed[] = [
  {
    email: '2023001001@demo.local',
    realName: '林思远',
    studentNo: '2023001001',
    classCode: 'SE-2301',
    coordinator: true,
  },
  {
    email: '2023001002@demo.local',
    realName: '周雨桐',
    studentNo: '2023001002',
    classCode: 'SE-2301',
  },
  {
    email: '2023001003@demo.local',
    realName: '陈子墨',
    studentNo: '2023001003',
    classCode: 'SE-2301',
  },
  {
    email: '2023001004@demo.local',
    realName: '许清妍',
    studentNo: '2023001004',
    classCode: 'SE-2301',
  },
  {
    email: '2023001005@demo.local',
    realName: '李明哲',
    studentNo: '2023001005',
    classCode: 'SE-2302',
  },
  {
    email: '2023001006@demo.local',
    realName: '王若涵',
    studentNo: '2023001006',
    classCode: 'SE-2302',
  },
  {
    email: '2023001007@demo.local',
    realName: '赵亦辰',
    studentNo: '2023001007',
    classCode: 'SE-2302',
  },
  {
    email: '2023001008@demo.local',
    realName: '孙晓彤',
    studentNo: '2023001008',
    classCode: 'SE-2302',
  },
  {
    email: '2023002001@demo.local',
    realName: '吴承宇',
    studentNo: '2023002001',
    classCode: 'CSE-2301',
  },
  {
    email: '2023002002@demo.local',
    realName: '郑心怡',
    studentNo: '2023002002',
    classCode: 'CSE-2301',
  },
  {
    email: '2023002003@demo.local',
    realName: '冯博文',
    studentNo: '2023002003',
    classCode: 'CSE-2301',
  },
  {
    email: '2023002004@demo.local',
    realName: '何嘉宁',
    studentNo: '2023002004',
    classCode: 'CSE-2301',
  },
  {
    email: '2023003001@demo.local',
    realName: '高子轩',
    studentNo: '2023003001',
    classCode: 'BA-2301',
  },
  {
    email: '2023003002@demo.local',
    realName: '罗欣然',
    studentNo: '2023003002',
    classCode: 'BA-2301',
  },
  {
    email: '2023003003@demo.local',
    realName: '梁浩然',
    studentNo: '2023003003',
    classCode: 'BA-2301',
  },
  {
    email: '2023003004@demo.local',
    realName: '宋雨薇',
    studentNo: '2023003004',
    classCode: 'BA-2301',
  },
  {
    email: '2023003005@demo.local',
    realName: '谢宇航',
    studentNo: '2023003005',
    classCode: 'BA-2302',
    coordinator: true,
  },
  {
    email: '2023003006@demo.local',
    realName: '唐语嫣',
    studentNo: '2023003006',
    classCode: 'BA-2302',
  },
  {
    email: '2023003007@demo.local',
    realName: '杜昊宇',
    studentNo: '2023003007',
    classCode: 'BA-2302',
  },
  {
    email: '2023003008@demo.local',
    realName: '潘思琪',
    studentNo: '2023003008',
    classCode: 'BA-2302',
  },
]

interface StaffSeed {
  email: string
  realName: string
  employeeNo: string
  positionName: string
  organizationCode: string
  roles?: Array<{ code: 'DEPARTMENT_ADMIN' | 'MAJOR_ADMIN'; scopeCode: string }>
  teacher?: {
    teacherNo: string
    title: string
    professionalInfo: string
    headTeacherClassCode?: string
  }
  counselorClassCodes?: string[]
}

const STAFF: readonly StaffSeed[] = [
  {
    email: 'admin.cs@demo.local',
    realName: '周建国',
    employeeNo: 'A2026001',
    positionName: '计算机学院副院长',
    organizationCode: 'CS',
    roles: [{ code: 'DEPARTMENT_ADMIN', scopeCode: 'CS' }],
  },
  {
    email: 'admin.mgt@demo.local',
    realName: '林雪梅',
    employeeNo: 'A2026002',
    positionName: '管理学院教学秘书',
    organizationCode: 'MGT',
    roles: [{ code: 'DEPARTMENT_ADMIN', scopeCode: 'MGT' }],
  },
  {
    email: 'admin.se@demo.local',
    realName: '韩志强',
    employeeNo: 'A2026003',
    positionName: '软件工程专业负责人',
    organizationCode: 'SE',
    roles: [{ code: 'MAJOR_ADMIN', scopeCode: 'SE' }],
  },
  {
    email: 'admin.ba@demo.local',
    realName: '董文静',
    employeeNo: 'A2026004',
    positionName: '工商管理专业负责人',
    organizationCode: 'BA',
    roles: [{ code: 'MAJOR_ADMIN', scopeCode: 'BA' }],
  },
  {
    email: 'teacher.se01@demo.local',
    realName: '陈浩',
    employeeNo: 'T2026001',
    positionName: '副教授',
    organizationCode: 'SE',
    teacher: {
      teacherNo: 'T2026001',
      title: '副教授',
      professionalInfo: '软件工程与云原生应用',
      headTeacherClassCode: 'SE-2301',
    },
  },
  {
    email: 'teacher.se02@demo.local',
    realName: '刘静',
    employeeNo: 'T2026002',
    positionName: '讲师',
    organizationCode: 'SE',
    teacher: {
      teacherNo: 'T2026002',
      title: '讲师',
      professionalInfo: '前端工程化与交互设计',
      headTeacherClassCode: 'SE-2302',
    },
  },
  {
    email: 'teacher.cse01@demo.local',
    realName: '赵明远',
    employeeNo: 'T2026003',
    positionName: '副教授',
    organizationCode: 'CSE',
    teacher: {
      teacherNo: 'T2026003',
      title: '副教授',
      professionalInfo: '人工智能与数据挖掘',
      headTeacherClassCode: 'CSE-2301',
    },
  },
  {
    email: 'teacher.ba01@demo.local',
    realName: '王丽',
    employeeNo: 'T2026004',
    positionName: '讲师',
    organizationCode: 'BA',
    teacher: {
      teacherNo: 'T2026004',
      title: '讲师',
      professionalInfo: '市场营销与消费者行为',
      headTeacherClassCode: 'BA-2301',
    },
  },
  {
    email: 'teacher.ba02@demo.local',
    realName: '张磊',
    employeeNo: 'T2026005',
    positionName: '讲师',
    organizationCode: 'BA',
    teacher: {
      teacherNo: 'T2026005',
      title: '讲师',
      professionalInfo: '运营管理与供应链',
      headTeacherClassCode: 'BA-2302',
    },
  },
  {
    email: 'teacher.cs01@demo.local',
    realName: '杨帆',
    employeeNo: 'T2026006',
    positionName: '教授',
    organizationCode: 'CS',
    teacher: { teacherNo: 'T2026006', title: '教授', professionalInfo: '数据库系统与信息管理' },
  },
  {
    email: 'counselor.cs@demo.local',
    realName: '黄晓燕',
    employeeNo: 'C2026001',
    positionName: '辅导员',
    organizationCode: 'CS',
    counselorClassCodes: ['SE-2301', 'SE-2302', 'CSE-2301'],
  },
  {
    email: 'counselor.mgt@demo.local',
    realName: '吴倩',
    employeeNo: 'C2026002',
    positionName: '辅导员',
    organizationCode: 'MGT',
    counselorClassCodes: ['BA-2301', 'BA-2302'],
  },
]

function runBaseSeed() {
  execFileSync(process.execPath, ['dist/prisma/seed.js'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  })
}

async function resetDatabase() {
  const superAdmin = await prisma.user.findUnique({
    where: { email: superAdminEmail },
    select: { id: true, email: true, realName: true },
  })

  if (!superAdmin) {
    throw new Error(`未找到需要保留的超级管理员账号：${superAdminEmail}`)
  }

  await prisma.$transaction(
    async (tx) => {
      await tx.auditLog.deleteMany()
      await tx.authSession.deleteMany()
      await tx.coordinatorQualificationOverride.deleteMany()
      await tx.studentClassTransfer.deleteMany()
      await tx.teacherClassDuty.deleteMany()
      await tx.counselorClassAssignment.deleteMany()
      await tx.studentProfile.deleteMany()
      await tx.teacherProfile.deleteMany()
      await tx.personnelProfile.deleteMany()
      await tx.userRoleHistory.deleteMany()
      await tx.userRole.deleteMany()
      await tx.rolePermission.deleteMany()
      await tx.roleMenu.deleteMany()
      await tx.permission.deleteMany()
      await tx.menu.deleteMany()
      await tx.role.deleteMany()
      await tx.organizationUnit.deleteMany({ where: { type: 'CLASS' } })
      await tx.organizationUnit.deleteMany({ where: { type: 'MAJOR' } })
      await tx.organizationUnit.deleteMany({ where: { type: 'DEPARTMENT' } })
      await tx.organizationUnit.deleteMany({ where: { type: 'SCHOOL' } })
      await tx.user.deleteMany({ where: { id: { not: superAdmin.id } } })
    },
    { maxWait: 10_000, timeout: 30_000 },
  )

  return superAdmin
}

async function createDemoData() {
  const admin = await prisma.user.findUnique({
    where: { email: superAdminEmail },
    select: { id: true },
  })
  const school = await prisma.organizationUnit.findFirst({
    where: { type: 'SCHOOL' },
    select: { id: true, code: true },
  })

  if (!admin || !school) throw new Error('基础数据初始化后未找到学校管理员或学校根节点')

  const passwordHash = await argon2.hash(demoPassword, { type: argon2.argon2id })

  const summary = await prisma.$transaction(
    async (tx) => {
      const roleIdByCode = new Map(
        (await tx.role.findMany({ select: { id: true, code: true } })).map((role) => [
          role.code,
          role.id,
        ]),
      )
      const idByCode = new Map<string, string>([
        [school.code, school.id],
        ['SCHOOL-ROOT', school.id],
      ])

      for (const node of ORG_TREE) {
        const parentId = idByCode.get(node.parentCode)
        if (!parentId) throw new Error(`缺少父组织：${node.parentCode}`)

        const { parentCode: _parentCode, ...organizationData } = node

        const organization = await tx.organizationUnit.create({
          data: { ...organizationData, parentId, createdById: admin.id },
          select: { id: true },
        })
        idByCode.set(node.code, organization.id)
      }

      const assignRole = async (userId: string, roleCode: string, scopeCode: string | null) => {
        const roleId = roleIdByCode.get(roleCode)
        if (!roleId) throw new Error(`缺少角色模板：${roleCode}`)
        const scopeOrgUnitId = scopeCode ? idByCode.get(scopeCode) : null
        const scopeKey = scopeOrgUnitId ?? 'GLOBAL'

        await tx.userRole.create({
          data: {
            userId,
            roleId,
            scopeOrgUnitId,
            scopeKey,
            assignedById: admin.id,
            createdById: admin.id,
          },
        })
      }

      let studentCount = 0
      let coordinatorCount = 0

      for (const student of STUDENTS) {
        const classId = idByCode.get(student.classCode)
        if (!classId) throw new Error(`缺少班级：${student.classCode}`)

        const user = await tx.user.create({
          data: {
            email: student.email,
            realName: student.realName,
            passwordHash,
            emailVerifiedAt: new Date(),
            createdById: admin.id,
          },
          select: { id: true },
        })
        await tx.studentProfile.create({
          data: {
            userId: user.id,
            studentNo: student.studentNo,
            classId,
            enrollmentYear: 2023,
            createdById: admin.id,
            updatedById: admin.id,
          },
        })
        await assignRole(user.id, 'STUDENT', null)
        studentCount += 1

        if (student.coordinator) {
          await assignRole(user.id, 'CLASS_COORDINATOR', student.classCode)
          coordinatorCount += 1
        }
      }

      let teacherCount = 0
      let staffCount = 0
      let counselorAssignmentCount = 0
      let headTeacherDutyCount = 0

      for (const staff of STAFF) {
        const organizationId = idByCode.get(staff.organizationCode)
        if (!organizationId) throw new Error(`缺少组织：${staff.organizationCode}`)

        const user = await tx.user.create({
          data: {
            email: staff.email,
            realName: staff.realName,
            passwordHash,
            emailVerifiedAt: new Date(),
            createdById: admin.id,
          },
          select: { id: true },
        })
        const personnel = await tx.personnelProfile.create({
          data: {
            userId: user.id,
            employeeNo: staff.employeeNo,
            positionName: staff.positionName,
            primaryOrganizationUnitId: organizationId,
            createdById: admin.id,
            updatedById: admin.id,
          },
          select: { id: true },
        })
        staffCount += 1

        for (const role of staff.roles ?? []) {
          await assignRole(user.id, role.code, role.scopeCode)
        }

        if (staff.teacher) {
          const teacher = await tx.teacherProfile.create({
            data: {
              personnelProfileId: personnel.id,
              teacherNo: staff.teacher.teacherNo,
              title: staff.teacher.title,
              professionalInfo: staff.teacher.professionalInfo,
              createdById: admin.id,
              updatedById: admin.id,
            },
            select: { id: true },
          })
          await assignRole(user.id, 'TEACHER', null)
          teacherCount += 1

          if (staff.teacher.headTeacherClassCode) {
            const classId = idByCode.get(staff.teacher.headTeacherClassCode)
            if (!classId) throw new Error(`缺少班级：${staff.teacher.headTeacherClassCode}`)
            await tx.teacherClassDuty.create({
              data: {
                teacherId: teacher.id,
                classId,
                assignedById: admin.id,
                createdById: admin.id,
              },
            })
            await assignRole(user.id, 'CLASS_COORDINATOR', staff.teacher.headTeacherClassCode)
            coordinatorCount += 1
            headTeacherDutyCount += 1
          }
        }

        for (const classCode of staff.counselorClassCodes ?? []) {
          const classId = idByCode.get(classCode)
          if (!classId) throw new Error(`缺少班级：${classCode}`)
          await tx.counselorClassAssignment.create({
            data: {
              userId: user.id,
              classId,
              assignedById: admin.id,
              createdById: admin.id,
            },
          })
          await assignRole(user.id, 'CLASS_COORDINATOR', classCode)
          coordinatorCount += 1
          counselorAssignmentCount += 1
        }
      }

      return {
        organizationCount: ORG_TREE.length + 1,
        studentCount,
        staffCount,
        teacherCount,
        headTeacherDutyCount,
        counselorAssignmentCount,
        coordinatorCount,
      }
    },
    { maxWait: 10_000, timeout: 30_000 },
  )

  return summary
}

async function main() {
  console.log(`准备清空数据库并保留超级管理员：${superAdminEmail}`)
  const admin = await resetDatabase()
  console.log(`已清空全部数据，保留账号：${admin.email}（${admin.realName}）`)

  console.log('正在重建角色、权限、菜单与学校根节点...')
  runBaseSeed()

  console.log('正在创建关联演示数据...')
  const summary = await createDemoData()
  console.log(
    `初始化完成：${summary.organizationCount} 个组织节点、${summary.studentCount} 名学生、${summary.staffCount} 名工作人员`,
  )
  console.log(
    `其中教师 ${summary.teacherCount} 位、班主任任职 ${summary.headTeacherDutyCount} 条、辅导员分配 ${summary.counselorAssignmentCount} 条、协管员授权 ${summary.coordinatorCount} 条。`,
  )
  console.log('演示账号初始密码由 RESET_DEMO_PASSWORD 控制；未设置时为 Demo@2026。')
}

main()
  .catch((error: unknown) => {
    console.error('重置并初始化失败：', error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
