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
 * 用户账号组织范围真实 HTTP 验收
 *
 * 临时数据带唯一后缀，结束后按外键顺序清理。
 */
describe('用户账号数据范围 (e2e)', () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const password = 'UsersE2E!123'
  const api = '/api'

  let app: INestApplication
  let prisma: PrismaService

  const orgIds: string[] = []
  const userIds: string[] = []
  const personnelProfileIds: string[] = []

  let majorAdminToken: string
  let deptAdminToken: string
  let schoolToken: string
  let studentAId: string
  let studentBId: string
  let teacherId: string
  let disabledAId: string
  let disabledBId: string
  let expiredRoleUserId: string
  let classBId: string

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
          // 组织级授权取组织节点 ID，平台级统一 GLOBAL（唯一键 uk_user_role_scope）
          scopeKey: scopeOrgUnitId ?? 'GLOBAL',
        },
      })
    }

    return user.id
  }

  async function login(identifier: string, pwd: string) {
    const response = await request(app.getHttpServer())
      .post(`${api}/auth/login`)
      .send({ identifier, password: pwd })

    expect([200, 201]).toContain(response.status)

    return response.body.data.accessToken as string
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

    async function createOrg(
      code: string,
      name: string,
      type: 'DEPARTMENT' | 'MAJOR' | 'CLASS',
      parentId: string,
    ) {
      const row = await prisma.organizationUnit.create({
        data: { code: `U-${code}-${suffix}`, name, type, parentId },
        select: { id: true },
      })

      orgIds.push(row.id)

      return row.id
    }

    const deptA = await createOrg('DEPT-A', '用户测试学院A', 'DEPARTMENT', school.id)
    const majorA = await createOrg('MAJOR-A', '用户测试专业A', 'MAJOR', deptA)
    const classA = await createOrg('CLASS-A', '用户测试班级A', 'CLASS', majorA)

    const deptB = await createOrg('DEPT-B', '用户测试学院B', 'DEPARTMENT', school.id)
    const majorB = await createOrg('MAJOR-B', '用户测试专业B', 'MAJOR', deptB)
    classBId = await createOrg('CLASS-B', '用户测试班级B', 'CLASS', majorB)

    await createUser('major-admin', 'MAJOR_ADMIN', majorA)
    await createUser('dept-admin', 'DEPARTMENT_ADMIN', deptA)

    studentAId = await createUser('student-a', 'STUDENT')
    studentBId = await createUser('student-b', 'STUDENT')
    teacherId = await createUser('teacher-a', 'TEACHER')
    disabledAId = await createUser('disabled-a', 'STUDENT')
    disabledBId = await createUser('disabled-b', 'STUDENT')
    expiredRoleUserId = await createUser('expired-role')

    await prisma.user.update({
      where: { id: disabledAId },
      data: { status: 'DISABLED' },
    })

    await prisma.user.update({
      where: { id: disabledBId },
      data: { status: 'DISABLED' },
    })

    const expiredRole = await prisma.role.findUniqueOrThrow({
      where: { code: 'DEPARTMENT_ADMIN' },
      select: { id: true },
    })

    await prisma.userRole.create({
      data: {
        userId: expiredRoleUserId,
        roleId: expiredRole.id,
        scopeOrgUnitId: deptA,
        scopeKey: deptA,
        validFrom: new Date('2020-01-01T00:00:00.000Z'),
        validUntil: new Date('2021-01-01T00:00:00.000Z'),
      },
    })

    await prisma.studentProfile.create({
      data: {
        userId: studentAId,
        studentNo: `UA-${suffix}`,
        classId: classA,
      },
    })

    await prisma.studentProfile.create({
      data: {
        userId: studentBId,
        studentNo: `UB-${suffix}`,
        classId: classBId,
      },
    })

    await prisma.studentProfile.create({
      data: {
        userId: disabledAId,
        studentNo: `UDA-${suffix}`,
        classId: classA,
        enrollmentStatus: 'SUSPENDED',
      },
    })

    await prisma.studentProfile.create({
      data: {
        userId: disabledBId,
        studentNo: `UDB-${suffix}`,
        classId: classBId,
        enrollmentStatus: 'SUSPENDED',
      },
    })

    // 教师身份挂在工作人员档案下：正式组织归属由 PersonnelProfile 表达
    const personnel = await prisma.personnelProfile.create({
      data: {
        userId: teacherId,
        employeeNo: `UE-${suffix}`,
        primaryOrganizationUnitId: deptA,
      },
      select: { id: true },
    })

    personnelProfileIds.push(personnel.id)

    await prisma.teacherProfile.create({
      data: {
        personnelProfileId: personnel.id,
        teacherNo: `UT-${suffix}`,
      },
    })

    majorAdminToken = await login(`major-admin-${suffix}@example.test`, password)
    deptAdminToken = await login(`dept-admin-${suffix}@example.test`, password)

    const schoolAdmin = await prisma.user.findFirstOrThrow({
      where: { email: process.env['SUPER_ADMIN_EMAIL'], deletedAt: null },
      select: { email: true },
    })

    schoolToken = await login(schoolAdmin.email ?? '', process.env['SUPER_ADMIN_PASSWORD'] ?? '')
  }, 60_000)

  afterAll(async () => {
    await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } })
    await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } })
    await prisma.studentProfile.deleteMany({ where: { userId: { in: userIds } } })
    await prisma.teacherProfile.deleteMany({
      where: { personnelProfileId: { in: personnelProfileIds } },
    })
    await prisma.personnelProfile.deleteMany({ where: { id: { in: personnelProfileIds } } })
    await prisma.user.deleteMany({ where: { id: { in: userIds } } })

    for (const id of [...orgIds].reverse()) {
      await prisma.organizationUnit.delete({ where: { id } })
    }

    await app.close()
  }, 60_000)

  it('MAJOR_ADMIN 只能看到本专业学生账号，不返回教师与其他专业学生', async () => {
    const response = await request(app.getHttpServer())
      .get(`${api}/users`)
      .query({ page: 1, pageSize: 50 })
      .set({ Authorization: `Bearer ${majorAdminToken}` })
      .expect(200)

    const ids = response.body.data.list.map((item: { id: string }) => item.id)

    expect(ids).toContain(studentAId)
    expect(ids).not.toContain(studentBId)
    expect(ids).not.toContain(teacherId)

    // E2-Fix-1：学生档案可见时允许显示无组织范围的 STUDENT 角色
    const studentItem = response.body.data.list.find(
      (item: { id: string }) => item.id === studentAId,
    )

    expect(studentItem.roles.map((role: { code: string }) => role.code)).toContain('STUDENT')
  })

  it('MAJOR_ADMIN 看到学生档案，但教师档案被字段级过滤', async () => {
    const response = await request(app.getHttpServer())
      .get(`${api}/users/${studentAId}`)
      .set({ Authorization: `Bearer ${majorAdminToken}` })
      .expect(200)

    expect(response.body.data.studentProfile.studentNo).toBe(`UA-${suffix}`)
    expect(response.body.data.teacherProfile).toBeNull()
  })

  it('跨专业访问用户详情 → 403', async () => {
    await request(app.getHttpServer())
      .get(`${api}/users/${studentBId}`)
      .set({ Authorization: `Bearer ${majorAdminToken}` })
      .expect(403)
  })

  it('伪造 orgUnitId 扩大范围 → 403', async () => {
    await request(app.getHttpServer())
      .get(`${api}/users`)
      .query({ page: 1, pageSize: 10, orgUnitId: classBId })
      .set({ Authorization: `Bearer ${majorAdminToken}` })
      .expect(403)
  })

  it('学校管理员可以在全校范围内看到学生与教师账号', async () => {
    const response = await request(app.getHttpServer())
      .get(`${api}/users`)
      .query({ page: 1, pageSize: 50 })
      .set({ Authorization: `Bearer ${schoolToken}` })
      .expect(200)

    const ids = response.body.data.list.map((item: { id: string }) => item.id)

    expect(ids).toEqual(expect.arrayContaining([studentAId, studentBId, teacherId]))
  })

  it('DEPARTMENT_ADMIN 只看到本院系学生和教师', async () => {
    const response = await request(app.getHttpServer())
      .get(`${api}/users`)
      .query({ page: 1, pageSize: 50 })
      .set({ Authorization: `Bearer ${deptAdminToken}` })
      .expect(200)

    const ids = response.body.data.list.map((item: { id: string }) => item.id)

    expect(ids).toEqual(expect.arrayContaining([studentAId, teacherId]))
    expect(ids).not.toContain(studentBId)
  })

  it('DEPARTMENT_ADMIN 跨院系详情 → 403', async () => {
    await request(app.getHttpServer())
      .get(`${api}/users/${studentBId}`)
      .set({ Authorization: `Bearer ${deptAdminToken}` })
      .expect(403)
  })

  it('status=DISABLED 只返回本院系范围内的禁用账号', async () => {
    const response = await request(app.getHttpServer())
      .get(`${api}/users`)
      .query({ page: 1, pageSize: 50, status: 'DISABLED' })
      .set({ Authorization: `Bearer ${deptAdminToken}` })
      .expect(200)

    const ids = response.body.data.list.map((item: { id: string }) => item.id)

    expect(ids).toContain(disabledAId)
    expect(ids).not.toContain(disabledBId)
  })

  it('过期角色不会扩大用户可见范围', async () => {
    const response = await request(app.getHttpServer())
      .get(`${api}/users`)
      .query({ page: 1, pageSize: 50 })
      .set({ Authorization: `Bearer ${deptAdminToken}` })
      .expect(200)

    const ids = response.body.data.list.map((item: { id: string }) => item.id)

    expect(ids).not.toContain(expiredRoleUserId)
  })

  it('响应不包含 passwordHash 或会话字段', async () => {
    const response = await request(app.getHttpServer())
      .get(`${api}/users/${studentAId}`)
      .set({ Authorization: `Bearer ${schoolToken}` })
      .expect(200)

    expect(response.body.data).not.toHaveProperty('passwordHash')
    expect(response.body.data).not.toHaveProperty('sessions')
  })
})
