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
 * 班级职责与 CLASS_COORDINATOR 管理
 *
 * 新契约要点：
 * - 教师身份挂在工作人员档案下（PersonnelProfile + TeacherProfile）；
 * - 撤销 = 写 user_role_history 快照后删除 user_roles 当前行；
 * - 学生只能协管本人当前班级（STUDENT_SELF），没有班助/学生负责人等其他学生类资格。
 */
describe('班级职责与 CLASS_COORDINATOR 管理 (e2e)', () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const password = 'CoordinatorE2E!123'
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
  let classA2: string
  let deptB: string
  let classB: string

  let studentId: string
  let student2Id: string
  let teacherProfileId: string
  let teacherUserId: string

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
      data: { code: `CM-${code}-${suffix}`, name, type, parentId },
      select: { id: true },
    })

    orgIds.push(row.id)

    return row.id
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

    deptA = await createOrg('DEPT-A', '职责测试学院A', 'DEPARTMENT', school.id)
    const majorA = await createOrg('MAJOR-A', '职责测试专业A', 'MAJOR', deptA)
    classA = await createOrg('CLASS-A', '职责测试班级A', 'CLASS', majorA)
    classA2 = await createOrg('CLASS-A2', '职责测试班级A2', 'CLASS', majorA)

    deptB = await createOrg('DEPT-B', '职责测试学院B', 'DEPARTMENT', school.id)
    const majorB = await createOrg('MAJOR-B', '职责测试专业B', 'MAJOR', deptB)
    classB = await createOrg('CLASS-B', '职责测试班级B', 'CLASS', majorB)

    await createUser('dept-admin', 'DEPARTMENT_ADMIN', deptA)
    await createUser('major-admin', 'MAJOR_ADMIN', majorA)

    studentId = await createUser('student', 'STUDENT')
    student2Id = await createUser('student-b', 'STUDENT')
    teacherUserId = await createUser('teacher')

    await prisma.studentProfile.create({
      data: { userId: studentId, studentNo: `CM-${suffix}-1`, classId: classA },
    })
    await prisma.studentProfile.create({
      data: { userId: student2Id, studentNo: `CM-${suffix}-2`, classId: classB },
    })

    // 教师身份挂在工作人员档案下
    const personnel = await prisma.personnelProfile.create({
      data: {
        userId: teacherUserId,
        employeeNo: `CM-E-${suffix}`,
        primaryOrganizationUnitId: deptA,
      },
      select: { id: true },
    })

    personnelProfileIds.push(personnel.id)

    const teacherProfile = await prisma.teacherProfile.create({
      data: { personnelProfileId: personnel.id, teacherNo: `CM-T-${suffix}` },
      select: { id: true },
    })

    teacherProfileId = teacherProfile.id
    teacherProfileIds.push(teacherProfile.id)

    deptToken = await login(`dept-admin-${suffix}@example.test`)
    majorToken = await login(`major-admin-${suffix}@example.test`)
    studentToken = await login(`student-${suffix}@example.test`)

    const schoolAdmin = await prisma.user.findFirstOrThrow({
      where: { email: process.env['SUPER_ADMIN_EMAIL'], deletedAt: null },
      select: { email: true },
    })

    schoolToken = await login(schoolAdmin.email ?? '', process.env['SUPER_ADMIN_PASSWORD'] ?? '')
  }, 60_000)

  afterAll(async () => {
    await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } })
    await prisma.teacherClassDuty.deleteMany({ where: { teacherId: { in: teacherProfileIds } } })
    await prisma.counselorClassAssignment.deleteMany({ where: { userId: { in: userIds } } })
    await prisma.coordinatorQualificationOverride.deleteMany({
      where: { userId: { in: userIds } },
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

  it('权限入口：未登录 401；STUDENT/MAJOR_ADMIN 无任职管理权限', async () => {
    await request(app.getHttpServer()).get(`${api}/teacher-class-duties`).expect(401)

    await request(app.getHttpServer())
      .get(`${api}/teacher-class-duties`)
      .set({ Authorization: `Bearer ${studentToken}` })
      .expect(403)

    await request(app.getHttpServer())
      .post(`${api}/teacher-class-duties`)
      .set({ Authorization: `Bearer ${majorToken}` })
      .send({ teacherId: teacherProfileId, classId: classA })
      .expect(403)
  })

  it('班主任任职：学校创建、重叠 409、院系管理员范围可见且跨院系 403', async () => {
    const created = await request(app.getHttpServer())
      .post(`${api}/teacher-class-duties`)
      .set({ Authorization: `Bearer ${schoolToken}` })
      .send({ teacherId: teacherProfileId, classId: classA })
      .expect(201)

    expect(created.body.data.classId).toBe(classA)

    await request(app.getHttpServer())
      .post(`${api}/teacher-class-duties`)
      .set({ Authorization: `Bearer ${schoolToken}` })
      .send({ teacherId: teacherProfileId, classId: classA })
      .expect(409)

    const list = await request(app.getHttpServer())
      .get(`${api}/teacher-class-duties`)
      .query({ page: 1, pageSize: 20, classId: classA })
      .set({ Authorization: `Bearer ${deptToken}` })
      .expect(200)

    expect(list.body.data.total).toBeGreaterThanOrEqual(1)

    await request(app.getHttpServer())
      .get(`${api}/teacher-class-duties`)
      .query({ classId: classB })
      .set({ Authorization: `Bearer ${deptToken}` })
      .expect(403)

    await request(app.getHttpServer())
      .post(`${api}/teacher-class-duties`)
      .set({ Authorization: `Bearer ${deptToken}` })
      .send({ teacherId: teacherProfileId, classId: classB })
      .expect(403)
  })

  it('撤销班主任任职：软撤销、重复撤销 409、历史可查', async () => {
    const created = await request(app.getHttpServer())
      .post(`${api}/teacher-class-duties`)
      .set({ Authorization: `Bearer ${schoolToken}` })
      .send({ teacherId: teacherProfileId, classId: classA2 })
      .expect(201)

    const dutyId = created.body.data.id as string

    await request(app.getHttpServer())
      .post(`${api}/teacher-class-duties/${dutyId}/revoke`)
      .set({ Authorization: `Bearer ${deptToken}` })
      .expect(201)

    await request(app.getHttpServer())
      .post(`${api}/teacher-class-duties/${dutyId}/revoke`)
      .set({ Authorization: `Bearer ${deptToken}` })
      .expect(409)

    const revoked = await request(app.getHttpServer())
      .get(`${api}/teacher-class-duties`)
      .query({ classId: classA2, status: 'REVOKED' })
      .set({ Authorization: `Bearer ${deptToken}` })
      .expect(200)

    expect(revoked.body.data.list[0].revokedAt).not.toBeNull()
  })

  it('辅导员分配：院系管理员可创建/撤销，跨院系 403', async () => {
    await request(app.getHttpServer())
      .post(`${api}/counselor-class-assignments`)
      .set({ Authorization: `Bearer ${deptToken}` })
      .send({ userId: studentId, classId: classA })
      .expect(201)

    await request(app.getHttpServer())
      .post(`${api}/counselor-class-assignments`)
      .set({ Authorization: `Bearer ${deptToken}` })
      .send({ userId: studentId, classId: classA })
      .expect(409)

    await request(app.getHttpServer())
      .post(`${api}/counselor-class-assignments`)
      .set({ Authorization: `Bearer ${deptToken}` })
      .send({ userId: studentId, classId: classB })
      .expect(403)

    const list = await request(app.getHttpServer())
      .get(`${api}/counselor-class-assignments`)
      .query({ classId: classA, userId: studentId })
      .set({ Authorization: `Bearer ${deptToken}` })
      .expect(200)

    const assignmentId = list.body.data.list[0].id as string

    await request(app.getHttpServer())
      .post(`${api}/counselor-class-assignments/${assignmentId}/revoke`)
      .set({ Authorization: `Bearer ${deptToken}` })
      .expect(201)
  })

  it('特殊覆盖：非学校管理员 403、空原因 400、授予/撤销成功', async () => {
    await request(app.getHttpServer())
      .post(`${api}/coordinator-overrides`)
      .set({ Authorization: `Bearer ${deptToken}` })
      .send({ userId: teacherUserId, classId: classB, reason: '测试' })
      .expect(403)

    await request(app.getHttpServer())
      .post(`${api}/coordinator-overrides`)
      .set({ Authorization: `Bearer ${schoolToken}` })
      .send({ userId: teacherUserId, classId: classB, reason: '   ' })
      .expect(400)

    const created = await request(app.getHttpServer())
      .post(`${api}/coordinator-overrides`)
      .set({ Authorization: `Bearer ${schoolToken}` })
      .send({ userId: teacherUserId, classId: classB, reason: '学校特殊指定' })
      .expect(201)

    const overrideId = created.body.data.id as string

    const role = await prisma.role.findUniqueOrThrow({
      where: { code: 'CLASS_COORDINATOR' },
      select: { id: true },
    })

    const activeAssignment = await prisma.userRole.findFirstOrThrow({
      where: { userId: teacherUserId, roleId: role.id, scopeOrgUnitId: classB },
      select: { id: true },
    })

    await request(app.getHttpServer())
      .post(`${api}/coordinator-overrides/${overrideId}/revoke`)
      .set({ Authorization: `Bearer ${schoolToken}` })
      .expect(201)

    // 授权行被删除，历史表中留下 QUALIFICATION_LOST 快照
    expect(await prisma.userRole.count({ where: { id: activeAssignment.id } })).toBe(0)

    const history = await prisma.userRoleHistory.findFirstOrThrow({
      where: { userRoleId: activeAssignment.id },
      select: { revocationReason: true },
    })

    expect(history.revocationReason).toBe('QUALIFICATION_LOST')
  })

  it('CLASS_COORDINATOR：无资格拒绝；学生可协管本班；重复分配 409；撤销写入 MANUAL 历史并可重新分配', async () => {
    // student2 在 classB，不能协管 classA（学生只能协管本人当前班级）
    await request(app.getHttpServer())
      .post(`${api}/role-assignments`)
      .set({ Authorization: `Bearer ${schoolToken}` })
      .send({ userId: student2Id, roleCode: 'CLASS_COORDINATOR', scopeOrgUnitId: classA })
      .expect(403)

    // student 在籍于 classA，具备 STUDENT_SELF 资格
    const eligibility = await request(app.getHttpServer())
      .get(`${api}/coordinator/eligibility`)
      .query({ userId: studentId, classId: classA })
      .set({ Authorization: `Bearer ${schoolToken}` })
      .expect(200)

    expect(eligibility.body.data.bases).toEqual(['STUDENT_SELF'])

    const first = await request(app.getHttpServer())
      .post(`${api}/role-assignments`)
      .set({ Authorization: `Bearer ${schoolToken}` })
      .send({ userId: studentId, roleCode: 'CLASS_COORDINATOR', scopeOrgUnitId: classA })
      .expect(201)

    await request(app.getHttpServer())
      .post(`${api}/role-assignments`)
      .set({ Authorization: `Bearer ${schoolToken}` })
      .send({ userId: studentId, roleCode: 'CLASS_COORDINATOR', scopeOrgUnitId: classA })
      .expect(409)

    const assignmentId = first.body.data.id as string

    const deleted = await request(app.getHttpServer())
      .delete(`${api}/role-assignments/${assignmentId}`)
      .set({ Authorization: `Bearer ${schoolToken}` })
      .expect(200)

    // 撤销接口返回被撤销的授权行 ID
    expect(deleted.body.data).toBe(assignmentId)

    expect(await prisma.userRole.count({ where: { id: assignmentId } })).toBe(0)

    const history = await prisma.userRoleHistory.findFirstOrThrow({
      where: { userRoleId: assignmentId },
      select: { revocationReason: true, revokedById: true, scopeKey: true },
    })

    expect(history.revocationReason).toBe('MANUAL')
    expect(history.revokedById).toBeTypeOf('string')
    expect(history.scopeKey).toBe(classA)

    // 撤销后可以重新分配
    await request(app.getHttpServer())
      .post(`${api}/role-assignments`)
      .set({ Authorization: `Bearer ${schoolToken}` })
      .send({ userId: studentId, roleCode: 'CLASS_COORDINATOR', scopeOrgUnitId: classA })
      .expect(201)
  })

  it('班主任任职撤销后，依赖该资格的协管授权被 QUALIFICATION_LOST 撤销', async () => {
    const duty = await prisma.teacherClassDuty.create({
      data: { teacherId: teacherProfileId, classId: classA2, dutyType: 'HEAD_TEACHER' },
      select: { id: true },
    })

    const assignment = await request(app.getHttpServer())
      .post(`${api}/role-assignments`)
      .set({ Authorization: `Bearer ${schoolToken}` })
      .send({
        userId: teacherUserId,
        roleCode: 'CLASS_COORDINATOR',
        scopeOrgUnitId: classA2,
      })
      .expect(201)

    const assignmentId = assignment.body.data.id as string

    await request(app.getHttpServer())
      .post(`${api}/teacher-class-duties/${duty.id}/revoke`)
      .set({ Authorization: `Bearer ${schoolToken}` })
      .expect(201)

    expect(await prisma.userRole.count({ where: { id: assignmentId } })).toBe(0)

    const history = await prisma.userRoleHistory.findFirstOrThrow({
      where: { userRoleId: assignmentId },
      select: { revocationReason: true },
    })

    expect(history.revocationReason).toBe('QUALIFICATION_LOST')
  })
})
