import 'dotenv/config'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { hash } from 'argon2'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../src/app.module.js'
import { configureGlobalEnhancers } from '../src/common/configure-global-enhancers.js'
import { PrismaService } from '../src/prisma/prisma.service.js'

/**
 * 教师档案：教师身份挂在工作人员档案之下。
 *
 * 覆盖：创建教师身份、重复编号、组织范围隔离、在职状态联动协管资格、
 * 正式组织归属调整（改由 PATCH /personnel-profiles/:id 承担）。
 */
describe('教师档案 API (e2e)', () => {
  // 工号最长 32 个字符，后缀保持紧凑
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const password = 'TeacherE2E!123'
  const api = '/api'

  let app: INestApplication
  let prisma: PrismaService

  const orgIds: string[] = []
  const userIds: string[] = []
  const personnelProfileIds: string[] = []
  const teacherProfileIds: string[] = []

  let schoolToken: string
  let deptToken: string
  let majorToken: string
  let studentToken: string

  let deptA: string
  let classA: string
  let deptB: string
  let classB: string

  async function createUser(label: string, roleCode?: string, scopeOrgUnitId?: string) {
    const user = await prisma.user.create({
      data: {
        email: `${label}-${suffix}@example.test`,
        passwordHash: await hash(password),
        realName: label,
        status: 'ACTIVE',
      },
      select: { id: true },
    })

    userIds.push(user.id)

    if (roleCode) {
      const role = await prisma.role.findUniqueOrThrow({
        where: { code: roleCode },
        select: { id: true },
      })

      await prisma.userRole.create({
        data: {
          userId: user.id,
          roleId: role.id,
          scopeOrgUnitId: scopeOrgUnitId ?? null,
          scopeKey: scopeOrgUnitId ?? 'GLOBAL',
        },
      })
    }

    return user.id
  }

  async function login(identifier: string, pwd: string = password) {
    const response = await request(app.getHttpServer())
      .post(`${api}/auth/login`)
      .send({ identifier, password: pwd })

    expect([200, 201]).toContain(response.status)

    return response.body.data.accessToken as string
  }

  async function createOrg(
    code: string,
    name: string,
    type: 'DEPARTMENT' | 'MAJOR' | 'CLASS',
    parentId: string,
  ) {
    const row = await prisma.organizationUnit.create({
      data: { code: `TE-${code}-${suffix}`, name, type, parentId },
      select: { id: true },
    })

    orgIds.push(row.id)

    return row.id
  }

  /** 工作人员档案 + 教师身份：接口契约要求先有人员档案 */
  async function createPersonnel(token: string, userId: string, primaryOrganizationUnitId: string) {
    const response = await request(app.getHttpServer())
      .post(`${api}/personnel-profiles`)
      .set({ Authorization: `Bearer ${token}` })
      .send({ userId, primaryOrganizationUnitId })
      .expect(201)

    personnelProfileIds.push(response.body.data.id)

    return response.body.data.id as string
  }

  async function createProfile(
    token: string,
    body: { personnelProfileId: string; teacherNo: string },
  ) {
    const response = await request(app.getHttpServer())
      .post(`${api}/teacher-profiles`)
      .set({ Authorization: `Bearer ${token}` })
      .send(body)
      .expect(201)

    teacherProfileIds.push(response.body.data.id)

    return response.body.data.id as string
  }

  /** 一步创建「账号 + 工作人员档案 + 教师身份」 */
  async function seedTeacher(
    label: string,
    departmentId: string,
  ): Promise<{ userId: string; personnelProfileId: string; teacherProfileId: string }> {
    const userId = await createUser(label)
    const personnelProfileId = await createPersonnel(schoolToken, userId, departmentId)
    const teacherProfileId = await createProfile(schoolToken, {
      personnelProfileId,
      teacherNo: `T-${label}-${suffix}`,
    })

    return { userId, personnelProfileId, teacherProfileId }
  }

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile()

    app = moduleFixture.createNestApplication()
    configureGlobalEnhancers(app)
    app.setGlobalPrefix('api')
    await app.init()

    prisma = app.get(PrismaService)

    const school = await prisma.organizationUnit.findFirstOrThrow({
      where: { type: 'SCHOOL', status: 'ACTIVE' },
      select: { id: true },
    })

    deptA = await createOrg('DEPT-A', '教师测试学院A', 'DEPARTMENT', school.id)
    const majorA = await createOrg('MAJOR-A', '教师测试专业A', 'MAJOR', deptA)
    classA = await createOrg('CLASS-A', '教师测试班级A', 'CLASS', majorA)

    deptB = await createOrg('DEPT-B', '教师测试学院B', 'DEPARTMENT', school.id)
    const majorB = await createOrg('MAJOR-B', '教师测试专业B', 'MAJOR', deptB)
    classB = await createOrg('CLASS-B', '教师测试班级B', 'CLASS', majorB)

    await createUser('dept-admin', 'DEPARTMENT_ADMIN', deptA)
    await createUser('major-admin', 'MAJOR_ADMIN', majorA)
    const studentId = await createUser('student', 'STUDENT')

    await prisma.studentProfile.create({
      data: {
        userId: studentId,
        studentNo: `TS-${suffix}`,
        classId: classA,
      },
    })

    deptToken = await login(`dept-admin-${suffix}@example.test`)
    majorToken = await login(`major-admin-${suffix}@example.test`)
    studentToken = await login(`student-${suffix}@example.test`)

    const schoolAdmin = await prisma.user.findFirstOrThrow({
      where: { email: process.env['SUPER_ADMIN_EMAIL'], deletedAt: null },
      select: { email: true },
    })

    schoolToken = await login(schoolAdmin.email, process.env['SUPER_ADMIN_PASSWORD'] ?? '')
  }, 60_000)

  afterAll(async () => {
    await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } })
    await prisma.teacherClassDuty.deleteMany({
      where: { teacherId: { in: teacherProfileIds } },
    })
    await prisma.userRoleHistory.deleteMany({ where: { userId: { in: userIds } } })
    await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } })
    await prisma.teacherProfile.deleteMany({ where: { id: { in: teacherProfileIds } } })
    await prisma.personnelProfile.deleteMany({ where: { id: { in: personnelProfileIds } } })
    await prisma.studentProfile.deleteMany({ where: { userId: { in: userIds } } })
    await prisma.user.deleteMany({ where: { id: { in: userIds } } })

    for (const id of [...orgIds].reverse()) {
      await prisma.organizationUnit.delete({ where: { id } })
    }

    await app.close()
  }, 60_000)

  it('SCHOOL_ADMIN 创建教师身份成功，重复教师编号 409', async () => {
    const userId = await createUser('new-teacher')
    const personnelProfileId = await createPersonnel(schoolToken, userId, deptA)
    const teacherNo = `T-${suffix}-1`

    const created = await request(app.getHttpServer())
      .post(`${api}/teacher-profiles`)
      .set({ Authorization: `Bearer ${schoolToken}` })
      .send({ personnelProfileId, teacherNo })
      .expect(201)

    teacherProfileIds.push(created.body.data.id)

    expect(created.body.data.personnelProfileId).toBe(personnelProfileId)
    expect(created.body.data.status).toBe('ACTIVE')

    // 同一工作人员不能重复建立教师身份
    await request(app.getHttpServer())
      .post(`${api}/teacher-profiles`)
      .set({ Authorization: `Bearer ${schoolToken}` })
      .send({ personnelProfileId, teacherNo: `T-${suffix}-dup` })
      .expect(409)

    // 教师编号重复
    const otherUserId = await createUser('dup-teacher')
    const otherPersonnelId = await createPersonnel(schoolToken, otherUserId, deptA)

    await request(app.getHttpServer())
      .post(`${api}/teacher-profiles`)
      .set({ Authorization: `Bearer ${schoolToken}` })
      .send({ personnelProfileId: otherPersonnelId, teacherNo })
      .expect(409)
  })

  it('工作人员档案不存在时不能创建教师身份 → 404', async () => {
    await request(app.getHttpServer())
      .post(`${api}/teacher-profiles`)
      .set({ Authorization: `Bearer ${schoolToken}` })
      .send({
        personnelProfileId: '00000000-0000-4000-8000-000000000001',
        teacherNo: `T-${suffix}-ghost`,
      })
      .expect(404)
  })

  it('DEPARTMENT_ADMIN 只能看到本院系教师，跨院系详情 403', async () => {
    const teacherA = await seedTeacher('ta', deptA)
    const teacherB = await seedTeacher('tb', deptB)

    const list = await request(app.getHttpServer())
      .get(`${api}/teacher-profiles`)
      .query({ page: 1, pageSize: 50 })
      .set({ Authorization: `Bearer ${deptToken}` })
      .expect(200)

    const organizationIds = list.body.data.list.map(
      (item: { organizationId: string }) => item.organizationId,
    )

    expect(organizationIds).toContain(deptA)
    expect(organizationIds).not.toContain(deptB)

    await request(app.getHttpServer())
      .get(`${api}/teacher-profiles/${teacherA.teacherProfileId}`)
      .set({ Authorization: `Bearer ${deptToken}` })
      .expect(200)

    await request(app.getHttpServer())
      .get(`${api}/teacher-profiles/${teacherB.teacherProfileId}`)
      .set({ Authorization: `Bearer ${deptToken}` })
      .expect(403)
  })

  it('MAJOR_ADMIN 与 STUDENT 没有教师档案管理权限', async () => {
    await request(app.getHttpServer())
      .get(`${api}/teacher-profiles`)
      .set({ Authorization: `Bearer ${majorToken}` })
      .expect(403)

    await request(app.getHttpServer())
      .get(`${api}/teacher-profiles`)
      .set({ Authorization: `Bearer ${studentToken}` })
      .expect(403)
  })

  it('教师离职撤销协管资格并留历史，恢复 ACTIVE 不恢复旧角色', async () => {
    const teacher = await seedTeacher('status-teacher', deptA)
    const role = await prisma.role.findUniqueOrThrow({
      where: { code: 'CLASS_COORDINATOR' },
      select: { id: true },
    })

    await prisma.teacherClassDuty.create({
      data: {
        teacherId: teacher.teacherProfileId,
        classId: classA,
        dutyType: 'HEAD_TEACHER',
      },
    })

    const assignment = await prisma.userRole.create({
      data: {
        userId: teacher.userId,
        roleId: role.id,
        scopeOrgUnitId: classA,
        scopeKey: classA,
      },
      select: { id: true },
    })

    await request(app.getHttpServer())
      .patch(`${api}/teacher-profiles/${teacher.teacherProfileId}/status`)
      .set({ Authorization: `Bearer ${deptToken}` })
      .send({ employmentStatus: 'LEFT' })
      .expect(200)

    expect(await prisma.userRole.count({ where: { id: assignment.id } })).toBe(0)

    const history = await prisma.userRoleHistory.findFirstOrThrow({
      where: { userRoleId: assignment.id },
      select: { revocationReason: true },
    })

    expect(history.revocationReason).toBe('QUALIFICATION_LOST')

    await request(app.getHttpServer())
      .patch(`${api}/teacher-profiles/${teacher.teacherProfileId}/status`)
      .set({ Authorization: `Bearer ${deptToken}` })
      .send({ employmentStatus: 'ACTIVE' })
      .expect(200)

    expect(
      await prisma.userRole.count({
        where: { userId: teacher.userId, roleId: role.id, scopeOrgUnitId: classA },
      }),
    ).toBe(0)
  })

  it('正式组织归属调整存在跨院系班级职责时返回 409', async () => {
    const teacher = await seedTeacher('move-teacher', deptA)

    await prisma.teacherClassDuty.create({
      data: { teacherId: teacher.teacherProfileId, classId: classA, dutyType: 'HEAD_TEACHER' },
    })

    await request(app.getHttpServer())
      .patch(`${api}/personnel-profiles/${teacher.personnelProfileId}`)
      .set({ Authorization: `Bearer ${schoolToken}` })
      .send({ primaryOrganizationUnitId: deptB })
      .expect(409)
  })

  it('DEPARTMENT_ADMIN 不能把工作人员调整到其他院系（范围外 403）', async () => {
    const teacher = await seedTeacher('dept-move', deptA)

    await request(app.getHttpServer())
      .patch(`${api}/personnel-profiles/${teacher.personnelProfileId}`)
      .set({ Authorization: `Bearer ${deptToken}` })
      .send({ primaryOrganizationUnitId: deptB })
      .expect(403)

    // 本院系内调整仍然允许
    await request(app.getHttpServer())
      .patch(`${api}/personnel-profiles/${teacher.personnelProfileId}`)
      .set({ Authorization: `Bearer ${deptToken}` })
      .send({ positionName: '讲师' })
      .expect(200)
  })

  it('教师院系调整接口已下架（旧 PATCH /teacher-profiles/:id/department 返回 404）', async () => {
    const teacher = await seedTeacher('legacy-endpoint', deptA)

    await request(app.getHttpServer())
      .patch(`${api}/teacher-profiles/${teacher.teacherProfileId}/department`)
      .set({ Authorization: `Bearer ${schoolToken}` })
      .send({ departmentId: deptB })
      .expect(404)
  })

  it('学籍转班接口仍然强制要求 reason（回归）', async () => {
    const studentUserId = await createUser('transfer-student', 'STUDENT')
    const profile = await prisma.studentProfile.create({
      data: {
        userId: studentUserId,
        studentNo: `TS-TR-${suffix}`,
        classId: classA,
      },
      select: { id: true },
    })

    await request(app.getHttpServer())
      .post(`${api}/student-profiles/${profile.id}/transfer`)
      .set({ Authorization: `Bearer ${schoolToken}` })
      .send({ targetClassId: classB })
      .expect(400)

    await prisma.studentProfile.delete({ where: { id: profile.id } })
  })
})
