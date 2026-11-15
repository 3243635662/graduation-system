import 'dotenv/config'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { hash } from 'argon2'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../src/app.module.js'
import { configureGlobalEnhancers } from '../src/common/configure-global-enhancers.js'
import { PrismaService } from '../src/prisma/prisma.service.js'

describe('教师档案 API (e2e)', () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const password = 'TeacherE2E!123'
  const api = '/api'

  let app: INestApplication
  let prisma: PrismaService

  const orgIds: string[] = []
  const userIds: string[] = []
  const profileIds: string[] = []

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
        displayName: label,
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
        data: { userId: user.id, roleId: role.id, scopeOrgUnitId: scopeOrgUnitId ?? null },
      })
    }

    return user.id
  }

  async function login(email: string, pwd: string = password) {
    const response = await request(app.getHttpServer())
      .post(`${api}/auth/login`)
      .send({ email, password: pwd })

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

  async function createProfile(
    token: string,
    body: { userId: string; teacherNo: string; departmentId: string },
  ) {
    const response = await request(app.getHttpServer())
      .post(`${api}/teacher-profiles`)
      .set({ Authorization: `Bearer ${token}` })
      .send(body)
      .expect(201)

    profileIds.push(response.body.data.id)

    return response.body.data.id as string
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
        name: '学生',
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
    await prisma.teacherClassDuty.deleteMany({ where: { teacherId: { in: profileIds } } })
    await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } })
    await prisma.teacherProfile.deleteMany({ where: { id: { in: profileIds } } })
    await prisma.studentProfile.deleteMany({ where: { userId: { in: userIds } } })
    await prisma.user.deleteMany({ where: { id: { in: userIds } } })

    for (const id of [...orgIds].reverse()) {
      await prisma.organizationUnit.delete({ where: { id } })
    }

    await app.close()
  }, 60_000)

  it('SCHOOL_ADMIN 创建教师档案成功，重复工号 409', async () => {
    const userId = await createUser('new-teacher')
    const teacherNo = `T-${suffix}-1`

    await createProfile(schoolToken, { userId, teacherNo, departmentId: deptA })

    const otherUserId = await createUser('dup-teacher')

    await request(app.getHttpServer())
      .post(`${api}/teacher-profiles`)
      .set({ Authorization: `Bearer ${schoolToken}` })
      .send({ userId: otherUserId, teacherNo, departmentId: deptA })
      .expect(409)
  })

  it('DEPARTMENT_ADMIN 只能看到本院系教师，跨院系详情 403', async () => {
    const teacherAUser = await createUser('teacher-a')
    const teacherBUser = await createUser('teacher-b')

    profileIds.push(
      await createProfile(schoolToken, {
        userId: teacherAUser,
        teacherNo: `T-${suffix}-A`,
        departmentId: deptA,
      }),
    )
    const teacherBProfile = await createProfile(schoolToken, {
      userId: teacherBUser,
      teacherNo: `T-${suffix}-B`,
      departmentId: deptB,
    })

    const list = await request(app.getHttpServer())
      .get(`${api}/teacher-profiles`)
      .query({ page: 1, pageSize: 50 })
      .set({ Authorization: `Bearer ${deptToken}` })
      .expect(200)

    const depIds = list.body.data.list.map((item: { departmentId: string }) => item.departmentId)

    expect(depIds).toContain(deptA)
    expect(depIds).not.toContain(deptB)

    await request(app.getHttpServer())
      .get(`${api}/teacher-profiles/${teacherBProfile}`)
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

  it('教师离职撤销协管资格，恢复 ACTIVE 不恢复旧角色', async () => {
    const teacherUser = await createUser('status-teacher')
    const profileId = await createProfile(schoolToken, {
      userId: teacherUser,
      teacherNo: `T-${suffix}-S`,
      departmentId: deptA,
    })

    const role = await prisma.role.findUniqueOrThrow({
      where: { code: 'CLASS_COORDINATOR' },
      select: { id: true },
    })

    await prisma.teacherClassDuty.create({
      data: {
        teacherId: profileId,
        classId: classA,
        dutyType: 'HEAD_TEACHER',
      },
    })

    await prisma.userRole.create({
      data: { userId: teacherUser, roleId: role.id, scopeOrgUnitId: classA },
    })

    await request(app.getHttpServer())
      .patch(`${api}/teacher-profiles/${profileId}/status`)
      .set({ Authorization: `Bearer ${deptToken}` })
      .send({ employmentStatus: 'LEFT' })
      .expect(200)

    const revoked = await prisma.userRole.findFirstOrThrow({
      where: { userId: teacherUser, roleId: role.id, scopeOrgUnitId: classA },
      select: { revokedAt: true, revocationReason: true },
    })

    expect(revoked.revokedAt).not.toBeNull()
    expect(revoked.revocationReason).toBe('QUALIFICATION_LOST')

    await request(app.getHttpServer())
      .patch(`${api}/teacher-profiles/${profileId}/status`)
      .set({ Authorization: `Bearer ${deptToken}` })
      .send({ employmentStatus: 'ACTIVE' })
      .expect(200)

    const active = await prisma.userRole.count({
      where: { userId: teacherUser, roleId: role.id, scopeOrgUnitId: classA, revokedAt: null },
    })

    expect(active).toBe(0)
  })

  it('院系调整存在跨院系班级职责时返回 409', async () => {
    const teacherUser = await createUser('move-teacher')
    const profileId = await createProfile(schoolToken, {
      userId: teacherUser,
      teacherNo: `T-${suffix}-M`,
      departmentId: deptA,
    })

    await prisma.teacherClassDuty.create({
      data: { teacherId: profileId, classId: classA, dutyType: 'HEAD_TEACHER' },
    })

    await request(app.getHttpServer())
      .patch(`${api}/teacher-profiles/${profileId}/department`)
      .set({ Authorization: `Bearer ${schoolToken}` })
      .send({ departmentId: deptB })
      .expect(409)
  })

  it('DEPARTMENT_ADMIN 不能调整院系（细分权限仅学校管理员）', async () => {
    const teacherUser = await createUser('dept-move-teacher')
    const profileId = await createProfile(schoolToken, {
      userId: teacherUser,
      teacherNo: `T-${suffix}-DM`,
      departmentId: deptA,
    })

    await request(app.getHttpServer())
      .patch(`${api}/teacher-profiles/${profileId}/department`)
      .set({ Authorization: `Bearer ${deptToken}` })
      .send({ departmentId: deptB })
      .expect(403)
  })

  it('学籍转班接口仍然强制要求 reason（回归）', async () => {
    const studentUserId = await createUser('transfer-student', 'STUDENT')
    const profile = await prisma.studentProfile.create({
      data: {
        userId: studentUserId,
        studentNo: `TS-TR-${suffix}`,
        name: '转班学生',
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
