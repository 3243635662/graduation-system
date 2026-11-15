import 'dotenv/config'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { CoordinatorActorPolicy } from '../src/modules/profiles/coordinator-actor-policy.service.js'
import { CoordinatorEligibilityService } from '../src/modules/profiles/coordinator-eligibility.service.js'
import { CoordinatorLifecycleService } from '../src/modules/profiles/coordinator-lifecycle.service.js'
import { CounselorClassAssignmentService } from '../src/modules/profiles/counselor-class-assignment.service.js'
import { TeacherClassDutyService } from '../src/modules/profiles/teacher-class-duty.service.js'
import { OrganizationService } from '../src/modules/rbac/organizations/organization.service.js'
import { PrismaService } from '../src/prisma/prisma.service.js'

/**
 * 真实数据库并发测试
 *
 * 只创建带唯一后缀的临时组织/用户/档案，测试结束后按外键顺序删除，
 * 不接触任何既有用户、组织、角色分配与 AuthSession。
 */
describe('任职时间区间并发防护（真实数据库）', () => {
  const suffix = `${Date.now()}`
  const prisma = new PrismaService()

  const createdOrgIds: string[] = []
  const createdUserIds: string[] = []
  const createdPersonnelIds: string[] = []
  const createdTeacherIds: string[] = []

  let actorId: string
  let classId: string
  let teacherAId: string
  let teacherBId: string
  let dutyService: TeacherClassDutyService
  let counselorService: CounselorClassAssignmentService

  beforeAll(async () => {
    await prisma.$connect()

    const adminEmail = process.env['SUPER_ADMIN_EMAIL']

    const admin = await prisma.user.findFirst({
      where: { email: adminEmail, deletedAt: null },
      select: { id: true },
    })

    // user_roles 只保存当前授权，撤销即删除行，因此这里不再过滤 revokedAt
    const adminAssignment = admin
      ? await prisma.userRole.findFirst({
          where: {
            userId: admin.id,
            role: { code: 'SCHOOL_ADMIN', status: 'ACTIVE' },
            scopeOrgUnitId: { not: null },
          },
          select: { id: true },
        })
      : null

    if (!admin || !adminAssignment) {
      throw new Error('缺少可用于测试的有效 SCHOOL_ADMIN 账号')
    }

    actorId = admin.id

    const school = await prisma.organizationUnit.findFirst({
      where: { type: 'SCHOOL', status: 'ACTIVE' },
      select: { id: true },
    })

    if (!school) throw new Error('缺少学校根组织')

    const department = await prisma.organizationUnit.create({
      data: {
        name: `并发测试学院-${suffix}`,
        code: `T-DEPT-${suffix}`,
        type: 'DEPARTMENT',
        parentId: school.id,
        createdById: actorId,
      },
      select: { id: true },
    })

    const major = await prisma.organizationUnit.create({
      data: {
        name: `并发测试专业-${suffix}`,
        code: `T-MAJOR-${suffix}`,
        type: 'MAJOR',
        parentId: department.id,
        createdById: actorId,
      },
      select: { id: true },
    })

    const klass = await prisma.organizationUnit.create({
      data: {
        name: `并发测试班级-${suffix}`,
        code: `T-CLASS-${suffix}`,
        type: 'CLASS',
        parentId: major.id,
        createdById: actorId,
      },
      select: { id: true },
    })

    createdOrgIds.push(department.id, major.id, klass.id)
    classId = klass.id

    const teacherUserA = await prisma.user.create({
      data: {
        email: `concurrency-a-${suffix}@example.test`,
        passwordHash: 'not-a-real-hash',
        realName: '并发教师A',
        status: 'ACTIVE',
      },
      select: { id: true },
    })

    const teacherUserB = await prisma.user.create({
      data: {
        email: `concurrency-b-${suffix}@example.test`,
        passwordHash: 'not-a-real-hash',
        realName: '并发教师B',
        status: 'ACTIVE',
      },
      select: { id: true },
    })

    createdUserIds.push(teacherUserA.id, teacherUserB.id)

    // 教师身份挂在工作人员档案下，账号通过 personnelProfile.userId 取得
    const personnelA = await prisma.personnelProfile.create({
      data: {
        userId: teacherUserA.id,
        employeeNo: `T-EA-${suffix}`,
        primaryOrganizationUnitId: department.id,
        createdById: actorId,
      },
      select: { id: true },
    })

    const personnelB = await prisma.personnelProfile.create({
      data: {
        userId: teacherUserB.id,
        employeeNo: `T-EB-${suffix}`,
        primaryOrganizationUnitId: department.id,
        createdById: actorId,
      },
      select: { id: true },
    })

    createdPersonnelIds.push(personnelA.id, personnelB.id)

    const teacherA = await prisma.teacherProfile.create({
      data: {
        personnelProfileId: personnelA.id,
        teacherNo: `T-A-${suffix}`,
        createdById: actorId,
      },
      select: { id: true },
    })

    const teacherB = await prisma.teacherProfile.create({
      data: {
        personnelProfileId: personnelB.id,
        teacherNo: `T-B-${suffix}`,
        createdById: actorId,
      },
      select: { id: true },
    })

    createdTeacherIds.push(teacherA.id, teacherB.id)
    teacherAId = teacherA.id
    teacherBId = teacherB.id

    const organizationService = new OrganizationService(prisma)
    const eligibility = new CoordinatorEligibilityService(prisma, organizationService)
    const lifecycle = new CoordinatorLifecycleService(eligibility, {
      invalidate: async () => undefined,
    } as unknown as ConstructorParameters<typeof CoordinatorLifecycleService>[1])
    const actorPolicy = new CoordinatorActorPolicy(prisma, organizationService)

    dutyService = new TeacherClassDutyService(prisma, organizationService, lifecycle, actorPolicy)

    counselorService = new CounselorClassAssignmentService(
      prisma,
      organizationService,
      lifecycle,
      actorPolicy,
    )
  })

  afterAll(async () => {
    await prisma.teacherClassDuty.deleteMany({ where: { teacherId: { in: createdTeacherIds } } })
    await prisma.counselorClassAssignment.deleteMany({ where: { classId } })
    await prisma.userRoleHistory.deleteMany({ where: { userId: { in: createdUserIds } } })
    await prisma.userRole.deleteMany({ where: { userId: { in: createdUserIds } } })
    await prisma.teacherProfile.deleteMany({ where: { id: { in: createdTeacherIds } } })
    await prisma.personnelProfile.deleteMany({ where: { id: { in: createdPersonnelIds } } })
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } })

    // 自关联外键要求自下而上逐个删除，批量 DELETE 会因父子引用顺序失败
    for (const orgId of [...createdOrgIds].reverse()) {
      await prisma.organizationUnit.delete({ where: { id: orgId } })
    }

    await prisma.$disconnect()
  })

  it('同一教师同一班级的重叠任职只允许一个成功', async () => {
    const validFrom = new Date('2030-01-01T00:00:00.000Z')
    const validUntil = new Date('2030-06-30T00:00:00.000Z')

    const results = await Promise.allSettled([
      dutyService.assign({ teacherId: teacherAId, classId, validFrom, validUntil }, actorId),
      dutyService.assign({ teacherId: teacherAId, classId, validFrom, validUntil }, actorId),
    ])

    const fulfilled = results.filter((item) => item.status === 'fulfilled')
    const rejected = results.filter((item) => item.status === 'rejected')

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)

    const reason = (rejected[0] as PromiseRejectedResult).reason as Error

    expect(reason.message).toContain('已存在相同的班主任任职')
  })

  it('同一教师不重叠的任职允许继续创建', async () => {
    const created = await dutyService.assign(
      {
        teacherId: teacherAId,
        classId,
        validFrom: new Date('2030-07-01T00:00:00.000Z'),
        validUntil: new Date('2030-12-31T00:00:00.000Z'),
      },
      actorId,
    )

    expect(created.id).toBeTruthy()
  })

  it('不同教师可以同时负责同一个班级', async () => {
    const window = {
      validFrom: new Date('2031-01-01T00:00:00.000Z'),
      validUntil: new Date('2031-06-30T00:00:00.000Z'),
    }

    const results = await Promise.allSettled([
      dutyService.assign({ teacherId: teacherAId, classId, ...window }, actorId),
      dutyService.assign({ teacherId: teacherBId, classId, ...window }, actorId),
    ])

    expect(results.every((item) => item.status === 'fulfilled')).toBe(true)
  })

  it('同一用户同一班级的重叠辅导员分配只允许一个成功', async () => {
    const userId = createdUserIds[0]!
    const window = {
      validFrom: new Date('2032-01-01T00:00:00.000Z'),
      validUntil: new Date('2032-06-30T00:00:00.000Z'),
    }

    const results = await Promise.allSettled([
      counselorService.assign({ userId, classId, ...window }, actorId),
      counselorService.assign({ userId, classId, ...window }, actorId),
    ])

    const fulfilled = results.filter((item) => item.status === 'fulfilled')

    expect(fulfilled).toHaveLength(1)

    const reason = (results.find((item) => item.status === 'rejected') as PromiseRejectedResult)
      .reason as Error

    expect(reason.message).toContain('已存在相同的辅导员分配')
  })
})
