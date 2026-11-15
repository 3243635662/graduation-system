import 'dotenv/config'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { hash } from 'argon2'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../src/app.module.js'
import { configureGlobalEnhancers } from '../src/common/configure-global-enhancers.js'
import { PrismaService } from '../src/prisma/prisma.service.js'

describe('学生档案 API (e2e)', () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const password = 'StudentE2E!123'
  const api = '/api'

  let app: INestApplication
  let prisma: PrismaService

  const orgIds: string[] = []
  const userIds: string[] = []
  const profileIds: string[] = []

  let schoolToken: string
  let deptToken: string
  let majorToken: string

  let classA1: string
  let classA2: string
  let classA3: string
  let classB: string
  let disabledClass: string

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
        data: {
          userId: user.id,
          roleId: role.id,
          scopeOrgUnitId: scopeOrgUnitId ?? null,
        },
      })
    }

    return user.id
  }

  async function login(email: string, pwd: string) {
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
    status: 'ACTIVE' | 'DISABLED' = 'ACTIVE',
  ) {
    const row = await prisma.organizationUnit.create({
      data: { code: `S-${code}-${suffix}`, name, type, parentId, status },
      select: { id: true },
    })

    orgIds.push(row.id)

    return row.id
  }

  async function createProfile(
    token: string,
    body: { name: string; studentNo: string; classId: string },
  ) {
    const response = await request(app.getHttpServer())
      .post(`${api}/student-profiles`)
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

    const deptA = await createOrg('DEPT-A', '学生测试学院A', 'DEPARTMENT', school.id)
    const majorA1 = await createOrg('MAJOR-A1', '学生测试专业A1', 'MAJOR', deptA)
    const majorA2 = await createOrg('MAJOR-A2', '学生测试专业A2', 'MAJOR', deptA)

    classA1 = await createOrg('CLASS-A1', '学生测试班级A1', 'CLASS', majorA1)
    classA2 = await createOrg('CLASS-A2', '学生测试班级A2', 'CLASS', majorA1)
    classA3 = await createOrg('CLASS-A3', '学生测试班级A3', 'CLASS', majorA2)
    disabledClass = await createOrg('CLASS-A4', '学生测试停用班级', 'CLASS', majorA1, 'DISABLED')

    const deptB = await createOrg('DEPT-B', '学生测试学院B', 'DEPARTMENT', school.id)
    const majorB = await createOrg('MAJOR-B', '学生测试专业B', 'MAJOR', deptB)
    classB = await createOrg('CLASS-B', '学生测试班级B', 'CLASS', majorB)

    await createUser('dept-admin', 'DEPARTMENT_ADMIN', deptA)
    await createUser('major-admin', 'MAJOR_ADMIN', majorA1)

    deptToken = await login(`dept-admin-${suffix}@example.test`, password)
    majorToken = await login(`major-admin-${suffix}@example.test`, password)

    const schoolAdmin = await prisma.user.findFirstOrThrow({
      where: { email: process.env['SUPER_ADMIN_EMAIL'], deletedAt: null },
      select: { email: true },
    })

    schoolToken = await login(schoolAdmin.email, process.env['SUPER_ADMIN_PASSWORD'] ?? '')
  }, 60_000)

  afterAll(async () => {
    await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } })
    await prisma.studentClassTransfer.deleteMany({
      where: { studentProfileId: { in: profileIds } },
    })
    await prisma.studentProfile.deleteMany({ where: { id: { in: profileIds } } })
    await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } })
    await prisma.user.deleteMany({ where: { id: { in: userIds } } })

    for (const id of [...orgIds].reverse()) {
      await prisma.organizationUnit.delete({ where: { id } })
    }

    await app.close()
  }, 60_000)

  it('可以创建未绑定账号的学生档案', async () => {
    const profileId = await createProfile(schoolToken, {
      name: '未注册学生',
      studentNo: `S-${suffix}-1`,
      classId: classA1,
    })

    const detail = await request(app.getHttpServer())
      .get(`${api}/student-profiles/${profileId}`)
      .set({ Authorization: `Bearer ${schoolToken}` })
      .expect(200)

    expect(detail.body.data.hasAccount).toBe(false)
    expect(detail.body.data.account).toBeNull()
    expect(detail.body.data.className).toBe('学生测试班级A1')
  })

  it('学号重复 → 409；班级类型错误或停用 → 400', async () => {
    const studentNo = `S-${suffix}-dup`

    await createProfile(schoolToken, { name: '重复学号', studentNo, classId: classA1 })

    await request(app.getHttpServer())
      .post(`${api}/student-profiles`)
      .set({ Authorization: `Bearer ${schoolToken}` })
      .send({ name: '重复学号', studentNo, classId: classA1 })
      .expect(409)

    await request(app.getHttpServer())
      .post(`${api}/student-profiles`)
      .set({ Authorization: `Bearer ${schoolToken}` })
      .send({ name: '错误班级', studentNo: `S-${suffix}-bad`, classId: 'not-a-uuid' })
      .expect(400)

    await request(app.getHttpServer())
      .post(`${api}/student-profiles`)
      .set({ Authorization: `Bearer ${schoolToken}` })
      .send({ name: '停用班级', studentNo: `S-${suffix}-disabled`, classId: disabledClass })
      .expect(403)
  })

  it('MAJOR_ADMIN 只能在本专业班级创建，跨专业 403', async () => {
    await createProfile(majorToken, {
      name: '专业内学生',
      studentNo: `S-${suffix}-major`,
      classId: classA2,
    })

    await request(app.getHttpServer())
      .post(`${api}/student-profiles`)
      .set({ Authorization: `Bearer ${majorToken}` })
      .send({ name: '跨专业学生', studentNo: `S-${suffix}-x`, classId: classB })
      .expect(403)
  })

  it('列表包含未注册学生，并支持 hasAccount 过滤', async () => {
    const response = await request(app.getHttpServer())
      .get(`${api}/student-profiles`)
      .query({ page: 1, pageSize: 50, classId: classA1 })
      .set({ Authorization: `Bearer ${schoolToken}` })
      .expect(200)

    expect(response.body.data.total).toBeGreaterThanOrEqual(1)
    expect(response.body.data.list.every((item: { hasAccount: boolean }) => !item.hasAccount)).toBe(
      true,
    )
  })

  it('MAJOR_ADMIN 转班本专业成功并写入历史；转其他专业 403', async () => {
    const profileId = await createProfile(schoolToken, {
      name: '转班学生',
      studentNo: `S-${suffix}-transfer`,
      classId: classA1,
    })

    await request(app.getHttpServer())
      .post(`${api}/student-profiles/${profileId}/transfer`)
      .set({ Authorization: `Bearer ${majorToken}` })
      .send({ targetClassId: classA2, reason: '专业内调整' })
      .expect(201)

    const detail = await request(app.getHttpServer())
      .get(`${api}/student-profiles/${profileId}`)
      .set({ Authorization: `Bearer ${schoolToken}` })
      .expect(200)

    expect(detail.body.data.classId).toBe(classA2)
    expect(detail.body.data.transfers).toHaveLength(1)
    expect(detail.body.data.transfers[0].reason).toBe('专业内调整')

    await request(app.getHttpServer())
      .post(`${api}/student-profiles/${profileId}/transfer`)
      .set({ Authorization: `Bearer ${majorToken}` })
      .send({ targetClassId: classB, reason: '跨专业尝试' })
      .expect(403)
  })

  it('转班原因为空 → 400', async () => {
    const profileId = await createProfile(schoolToken, {
      name: '空原因',
      studentNo: `S-${suffix}-reason`,
      classId: classA1,
    })

    await request(app.getHttpServer())
      .post(`${api}/student-profiles/${profileId}/transfer`)
      .set({ Authorization: `Bearer ${schoolToken}` })
      .send({ targetClassId: classA2, reason: '   ' })
      .expect(400)
  })

  it('学生转班后，仅由学生身份获得的旧班级协管角色被终止', async () => {
    const studentUserId = await createUser('transfer-coordinator', 'STUDENT')
    const role = await prisma.role.findUniqueOrThrow({
      where: { code: 'CLASS_COORDINATOR' },
      select: { id: true },
    })

    const profile = await prisma.studentProfile.create({
      data: {
        userId: studentUserId,
        studentNo: `S-${suffix}-coord`,
        name: '协管学生',
        classId: classA1,
      },
      select: { id: true },
    })

    profileIds.push(profile.id)

    await prisma.userRole.create({
      data: {
        userId: studentUserId,
        roleId: role.id,
        scopeOrgUnitId: classA1,
      },
    })

    await request(app.getHttpServer())
      .post(`${api}/student-profiles/${profile.id}/transfer`)
      .set({ Authorization: `Bearer ${schoolToken}` })
      .send({ targetClassId: classA2, reason: '同专业转班' })
      .expect(201)

    const assignment = await prisma.userRole.findFirstOrThrow({
      where: { userId: studentUserId, roleId: role.id, scopeOrgUnitId: classA1 },
      select: { revokedAt: true, revocationReason: true },
    })

    expect(assignment.revokedAt).not.toBeNull()
    expect(assignment.revocationReason).toBe('QUALIFICATION_LOST')
  })

  it('MAJOR_ADMIN 无学籍状态权限 → 403；DEPARTMENT_ADMIN 修改并撤销失效协管角色', async () => {
    const studentUserId = await createUser('status-student', 'STUDENT')
    const role = await prisma.role.findUniqueOrThrow({
      where: { code: 'CLASS_COORDINATOR' },
      select: { id: true },
    })

    const profile = await prisma.studentProfile.create({
      data: {
        userId: studentUserId,
        studentNo: `S-${suffix}-status`,
        name: '学籍学生',
        classId: classA1,
      },
      select: { id: true },
    })

    profileIds.push(profile.id)

    await prisma.userRole.create({
      data: {
        userId: studentUserId,
        roleId: role.id,
        scopeOrgUnitId: classA1,
      },
    })

    await request(app.getHttpServer())
      .patch(`${api}/student-profiles/${profile.id}/status`)
      .set({ Authorization: `Bearer ${majorToken}` })
      .send({ enrollmentStatus: 'SUSPENDED' })
      .expect(403)

    await request(app.getHttpServer())
      .patch(`${api}/student-profiles/${profile.id}/status`)
      .set({ Authorization: `Bearer ${deptToken}` })
      .send({ enrollmentStatus: 'SUSPENDED' })
      .expect(200)

    const detail = await request(app.getHttpServer())
      .get(`${api}/student-profiles/${profile.id}`)
      .set({ Authorization: `Bearer ${deptToken}` })
      .expect(200)

    expect(detail.body.data.enrollmentStatus).toBe('SUSPENDED')

    const revoked = await prisma.userRole.findFirstOrThrow({
      where: { userId: studentUserId, roleId: role.id, scopeOrgUnitId: classA1 },
      select: { revokedAt: true, revocationReason: true },
    })

    expect(revoked.revokedAt).not.toBeNull()
    expect(revoked.revocationReason).toBe('QUALIFICATION_LOST')

    // 恢复 ACTIVE 不会自动恢复旧角色
    await request(app.getHttpServer())
      .patch(`${api}/student-profiles/${profile.id}/status`)
      .set({ Authorization: `Bearer ${deptToken}` })
      .send({ enrollmentStatus: 'ACTIVE' })
      .expect(200)

    const active = await prisma.userRole.count({
      where: {
        userId: studentUserId,
        roleId: role.id,
        scopeOrgUnitId: classA1,
        revokedAt: null,
      },
    })

    expect(active).toBe(0)
  })

  it('DEPARTMENT_ADMIN 跨院系查看/转班 → 403', async () => {
    const profileId = await createProfile(schoolToken, {
      name: '外院学生',
      studentNo: `S-${suffix}-other`,
      classId: classB,
    })

    await request(app.getHttpServer())
      .get(`${api}/student-profiles/${profileId}`)
      .set({ Authorization: `Bearer ${deptToken}` })
      .expect(403)
  })

  it('同一学生并发转班只能成功一次', async () => {
    const profileId = await createProfile(schoolToken, {
      name: '并发转班',
      studentNo: `S-${suffix}-race`,
      classId: classA1,
    })

    const results = await Promise.allSettled([
      request(app.getHttpServer())
        .post(`${api}/student-profiles/${profileId}/transfer`)
        .set({ Authorization: `Bearer ${schoolToken}` })
        .send({ targetClassId: classA2, reason: '并发A' }),
      request(app.getHttpServer())
        .post(`${api}/student-profiles/${profileId}/transfer`)
        .set({ Authorization: `Bearer ${schoolToken}` })
        .send({ targetClassId: classA3, reason: '并发B' }),
    ])

    const success = results.filter(
      (item) => item.status === 'fulfilled' && item.value.status === 201,
    )

    expect(success).toHaveLength(1)
  })
})
