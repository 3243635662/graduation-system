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
  // 学号 / 工号最长 32 个字符，后缀保持紧凑
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
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
    body: { userId: string; studentNo: string; classId?: string },
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

    deptToken = await login(`dept-admin-${suffix}@example.test`)
    majorToken = await login(`major-admin-${suffix}@example.test`)

    const schoolAdmin = await prisma.user.findFirstOrThrow({
      where: { email: process.env['SUPER_ADMIN_EMAIL'], deletedAt: null },
      select: { email: true },
    })

    schoolToken = await login(schoolAdmin.email, process.env['SUPER_ADMIN_PASSWORD'] ?? '')
  }, 60_000)

  afterAll(async () => {
    await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } })
    // 转班会写入审计记录，测试数据需要一并清理（生产环境审计只追加）
    await prisma.auditLog.deleteMany({ where: { targetId: { in: profileIds } } })
    await prisma.studentClassTransfer.deleteMany({
      where: { studentProfileId: { in: profileIds } },
    })
    await prisma.userRoleHistory.deleteMany({ where: { userId: { in: userIds } } })
    await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } })
    await prisma.studentProfile.deleteMany({ where: { id: { in: profileIds } } })
    await prisma.user.deleteMany({ where: { id: { in: userIds } } })

    for (const id of [...orgIds].reverse()) {
      await prisma.organizationUnit.delete({ where: { id } })
    }

    await app.close()
  }, 60_000)

  it('必须先有账号才能建立学生档案，详情返回账号摘要与班级路径', async () => {
    const studentUserId = await createUser('profile-student')

    const profileId = await createProfile(schoolToken, {
      userId: studentUserId,
      studentNo: `S-${suffix}-1`,
      classId: classA1,
    })

    const detail = await request(app.getHttpServer())
      .get(`${api}/student-profiles/${profileId}`)
      .set({ Authorization: `Bearer ${schoolToken}` })
      .expect(200)

    // 账号摘要里的 id 即档案绑定的 userId（档案不再有 hasAccount 语义）
    expect(detail.body.data.account.id).toBe(studentUserId)
    expect(detail.body.data.realName).toBe('profile-student')
    expect(detail.body.data.account.email).toBe(`profile-student-${suffix}@example.test`)
    expect(detail.body.data.className).toBe('学生测试班级A1')
    expect(detail.body.data.majorName).toBe('学生测试专业A1')
    // 档案不再保存第二份姓名，也不再有「无账号」语义
    expect(detail.body.data).not.toHaveProperty('name')
    expect(detail.body.data).not.toHaveProperty('hasAccount')
  })

  it('缺少 userId 时返回 400，不能创建无主档案', async () => {
    const response = await request(app.getHttpServer())
      .post(`${api}/student-profiles`)
      .set({ Authorization: `Bearer ${schoolToken}` })
      .send({ studentNo: `S-${suffix}-no-user`, classId: classA1 })
      .expect(400)

    expect(response.body.code).toBe(40001)

    const paths = (response.body.data as Array<{ path: string }>).map((issue) => issue.path)

    expect(paths).toContain('userId')
  })

  it('绑定的账号不存在 → 404；学号重复 → 409；班级非法或停用 → 400/403', async () => {
    await request(app.getHttpServer())
      .post(`${api}/student-profiles`)
      .set({ Authorization: `Bearer ${schoolToken}` })
      .send({
        userId: '00000000-0000-4000-8000-000000000001',
        studentNo: `S-${suffix}-ghost`,
        classId: classA1,
      })
      .expect(404)

    const studentNo = `S-${suffix}-dup`
    const firstUserId = await createUser('dup-first')
    const secondUserId = await createUser('dup-second')

    await createProfile(schoolToken, { userId: firstUserId, studentNo, classId: classA1 })

    await request(app.getHttpServer())
      .post(`${api}/student-profiles`)
      .set({ Authorization: `Bearer ${schoolToken}` })
      .send({ userId: secondUserId, studentNo, classId: classA1 })
      .expect(409)

    await request(app.getHttpServer())
      .post(`${api}/student-profiles`)
      .set({ Authorization: `Bearer ${schoolToken}` })
      .send({ userId: secondUserId, studentNo: `S-${suffix}-bad`, classId: 'not-a-uuid' })
      .expect(400)

    await request(app.getHttpServer())
      .post(`${api}/student-profiles`)
      .set({ Authorization: `Bearer ${schoolToken}` })
      .send({ userId: secondUserId, studentNo: `S-${suffix}-disabled`, classId: disabledClass })
      .expect(403)

    // 同一账号只能有一份学生档案
    await request(app.getHttpServer())
      .post(`${api}/student-profiles`)
      .set({ Authorization: `Bearer ${schoolToken}` })
      .send({ userId: firstUserId, studentNo: `S-${suffix}-second`, classId: classA1 })
      .expect(409)
  })

  it('未分班学生可以正常建立档案，并能通过 unassignedOnly 筛出', async () => {
    const studentUserId = await createUser('unassigned-student')
    const studentNo = `S-${suffix}-unassigned`

    const profileId = await createProfile(schoolToken, { userId: studentUserId, studentNo })

    const detail = await request(app.getHttpServer())
      .get(`${api}/student-profiles/${profileId}`)
      .set({ Authorization: `Bearer ${schoolToken}` })
      .expect(200)

    expect(detail.body.data.classId).toBeNull()
    expect(detail.body.data.className).toBeNull()

    const unassigned = await request(app.getHttpServer())
      .get(`${api}/student-profiles`)
      .query({ page: 1, pageSize: 50, unassignedOnly: 'true', studentNo })
      .set({ Authorization: `Bearer ${schoolToken}` })
      .expect(200)

    expect(unassigned.body.data.total).toBe(1)
    expect(unassigned.body.data.list[0]).toMatchObject({
      id: profileId,
      studentNo,
      classId: null,
      className: null,
    })

    // 同样的学号在「已分班」筛选下不可见，说明 unassignedOnly 真的生效
    const assigned = await request(app.getHttpServer())
      .get(`${api}/student-profiles`)
      .query({ page: 1, pageSize: 50, unassignedOnly: 'false', classId: classA1 })
      .set({ Authorization: `Bearer ${schoolToken}` })
      .expect(200)

    expect(
      (assigned.body.data.list as Array<{ studentNo: string }>).some(
        (item) => item.studentNo === studentNo,
      ),
    ).toBe(false)

    // 首次分班走同一个 transfer 接口
    await request(app.getHttpServer())
      .post(`${api}/student-profiles/${profileId}/transfer`)
      .set({ Authorization: `Bearer ${schoolToken}` })
      .send({ targetClassId: classA1, reason: '新生首次分班' })
      .expect(201)

    const assignedDetail = await request(app.getHttpServer())
      .get(`${api}/student-profiles/${profileId}`)
      .set({ Authorization: `Bearer ${schoolToken}` })
      .expect(200)

    expect(assignedDetail.body.data.classId).toBe(classA1)
    expect(assignedDetail.body.data.transfers[0].fromClassId).toBeNull()
  })

  it('MAJOR_ADMIN 只能在本专业班级创建，跨专业 403', async () => {
    const insideUserId = await createUser('major-inside')
    const outsideUserId = await createUser('major-outside')

    await createProfile(majorToken, {
      userId: insideUserId,
      studentNo: `S-${suffix}-major`,
      classId: classA2,
    })

    await request(app.getHttpServer())
      .post(`${api}/student-profiles`)
      .set({ Authorization: `Bearer ${majorToken}` })
      .send({ userId: outsideUserId, studentNo: `S-${suffix}-x`, classId: classB })
      .expect(403)
  })

  it('MAJOR_ADMIN 转班本专业成功并写入历史；转其他专业 403', async () => {
    const studentUserId = await createUser('transfer-student')
    const profileId = await createProfile(schoolToken, {
      userId: studentUserId,
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
    const studentUserId = await createUser('empty-reason')
    const profileId = await createProfile(schoolToken, {
      userId: studentUserId,
      studentNo: `S-${suffix}-reason`,
      classId: classA1,
    })

    await request(app.getHttpServer())
      .post(`${api}/student-profiles/${profileId}/transfer`)
      .set({ Authorization: `Bearer ${schoolToken}` })
      .send({ targetClassId: classA2, reason: '   ' })
      .expect(400)
  })

  it('学生转班后，仅由学生身份获得的旧班级协管授权被终止并留下历史', async () => {
    const studentUserId = await createUser('transfer-coordinator', 'STUDENT')
    const role = await prisma.role.findUniqueOrThrow({
      where: { code: 'CLASS_COORDINATOR' },
      select: { id: true },
    })

    const profile = await prisma.studentProfile.create({
      data: {
        userId: studentUserId,
        studentNo: `S-${suffix}-coord`,
        classId: classA1,
      },
      select: { id: true },
    })

    profileIds.push(profile.id)

    const assignment = await prisma.userRole.create({
      data: {
        userId: studentUserId,
        roleId: role.id,
        scopeOrgUnitId: classA1,
        scopeKey: classA1,
      },
      select: { id: true },
    })

    await request(app.getHttpServer())
      .post(`${api}/student-profiles/${profile.id}/transfer`)
      .set({ Authorization: `Bearer ${schoolToken}` })
      .send({ targetClassId: classA2, reason: '同专业转班' })
      .expect(201)

    // 撤销语义：当前授权行被删除，历史表保留 QUALIFICATION_LOST 快照
    expect(await prisma.userRole.count({ where: { id: assignment.id } })).toBe(0)

    const history = await prisma.userRoleHistory.findFirstOrThrow({
      where: { userRoleId: assignment.id },
      select: { revocationReason: true, scopeOrgUnitId: true, userId: true },
    })

    expect(history.userId).toBe(studentUserId)
    expect(history.scopeOrgUnitId).toBe(classA1)
    expect(history.revocationReason).toBe('QUALIFICATION_LOST')
  })

  it('学籍状态：MAJOR_ADMIN 只能改本专业学生；状态变化撤销失效协管角色', async () => {
    const studentUserId = await createUser('status-student', 'STUDENT')
    const role = await prisma.role.findUniqueOrThrow({
      where: { code: 'CLASS_COORDINATOR' },
      select: { id: true },
    })

    const profile = await prisma.studentProfile.create({
      data: {
        userId: studentUserId,
        studentNo: `S-${suffix}-status`,
        classId: classA1,
      },
      select: { id: true },
    })

    profileIds.push(profile.id)

    const assignment = await prisma.userRole.create({
      data: {
        userId: studentUserId,
        roleId: role.id,
        scopeOrgUnitId: classA1,
        scopeKey: classA1,
      },
      select: { id: true },
    })

    // 专业管理员拥有学籍状态权限，但只能作用于本专业学生
    await request(app.getHttpServer())
      .patch(`${api}/student-profiles/${profile.id}/status`)
      .set({ Authorization: `Bearer ${majorToken}` })
      .send({ enrollmentStatus: 'SUSPENDED' })
      .expect(200)

    // 跨专业（classB 的学生）对专业管理员不可见
    const outsideUserId = await createUser('status-outside')
    const outsideProfileId = await createProfile(schoolToken, {
      userId: outsideUserId,
      studentNo: `S-${suffix}-outside`,
      classId: classB,
    })

    await request(app.getHttpServer())
      .patch(`${api}/student-profiles/${outsideProfileId}/status`)
      .set({ Authorization: `Bearer ${majorToken}` })
      .send({ enrollmentStatus: 'SUSPENDED' })
      .expect(403)

    const detail = await request(app.getHttpServer())
      .get(`${api}/student-profiles/${profile.id}`)
      .set({ Authorization: `Bearer ${deptToken}` })
      .expect(200)

    expect(detail.body.data.enrollmentStatus).toBe('SUSPENDED')

    expect(await prisma.userRole.count({ where: { id: assignment.id } })).toBe(0)

    const history = await prisma.userRoleHistory.findFirstOrThrow({
      where: { userRoleId: assignment.id },
      select: { revocationReason: true },
    })

    expect(history.revocationReason).toBe('QUALIFICATION_LOST')

    // 恢复 ACTIVE 不会自动恢复旧角色
    await request(app.getHttpServer())
      .patch(`${api}/student-profiles/${profile.id}/status`)
      .set({ Authorization: `Bearer ${deptToken}` })
      .send({ enrollmentStatus: 'ACTIVE' })
      .expect(200)

    expect(
      await prisma.userRole.count({
        where: { userId: studentUserId, roleId: role.id, scopeOrgUnitId: classA1 },
      }),
    ).toBe(0)
  })

  it('DEPARTMENT_ADMIN 跨院系查看/转班 → 403', async () => {
    const studentUserId = await createUser('other-dept-student')
    const profileId = await createProfile(schoolToken, {
      userId: studentUserId,
      studentNo: `S-${suffix}-other`,
      classId: classB,
    })

    await request(app.getHttpServer())
      .get(`${api}/student-profiles/${profileId}`)
      .set({ Authorization: `Bearer ${deptToken}` })
      .expect(403)
  })

  it('同一学生并发转班只能成功一次', async () => {
    const studentUserId = await createUser('race-student')
    const profileId = await createProfile(schoolToken, {
      userId: studentUserId,
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
