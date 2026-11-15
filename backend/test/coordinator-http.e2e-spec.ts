import 'dotenv/config'
import { buildMenuCacheVersionKey } from '@graduation/shared'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { hash, verify } from 'argon2'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../src/app.module.js'
import { configureGlobalEnhancers } from '../src/common/configure-global-enhancers.js'
import { RedisService } from '../src/common/redis/redis.service.js'
import { PrismaService } from '../src/prisma/prisma.service.js'

/**
 * 协管员 HTTP 端到端验收
 *
 * 使用真实 Nest 应用、真实 Prisma/MySQL、真实 Redis 与真实认证，
 * 所有测试数据带唯一后缀并在结束时清理；不对既有用户与组织做任何写入。
 *
 * 新契约：撤销 = 写 user_role_history 后删除 user_roles 当前行；
 * 学生类资格只有 STUDENT_SELF（只能协管本人当前班级）。
 */
describe('协管员 HTTP E2E（真实数据库）', () => {
  const suffix = `${Date.now()}`
  const password = 'PhaseD!Test123'
  const api = '/api'

  let app: INestApplication
  let prisma: PrismaService
  let redis: RedisService

  const orgIds: string[] = []
  const userIds: string[] = []

  let deptAId: string
  let classAId: string
  let classBId: string

  let schoolToken: string
  let deptToken: string
  let studentToken: string
  let studentId: string

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

  async function createUser(emailPrefix: string, roleCode: string, scopeOrgUnitId?: string) {
    const user = await prisma.user.create({
      data: {
        email: `${emailPrefix}-${suffix}@example.test`,
        passwordHash: await hash(password),
        realName: `${emailPrefix}-${suffix}`,
        status: 'ACTIVE',
      },
      select: { id: true },
    })

    userIds.push(user.id)

    const saved = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { email: true, passwordHash: true },
    })

    if (!(await verify(saved.passwordHash, password))) {
      throw new Error(`测试账号密码哈希校验失败：${saved.email}`)
    }

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
        assignedById: user.id,
        createdById: user.id,
      },
    })

    return user.id
  }

  async function login(identifier: string, loginPassword: string = password) {
    const response = await request(app.getHttpServer())
      .post(`${api}/auth/login`)
      .send({ identifier, password: loginPassword })

    if (response.status !== 200 && response.status !== 201) {
      throw new Error(
        `登录失败(${identifier}) ${response.status}: ${JSON.stringify(response.body)}`,
      )
    }

    return response.body.data.accessToken as string
  }

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile()

    app = moduleFixture.createNestApplication()
    configureGlobalEnhancers(app)
    app.setGlobalPrefix('api')
    await app.init()

    prisma = app.get(PrismaService)
    redis = app.get(RedisService)

    const school = await prisma.organizationUnit.findFirstOrThrow({
      where: { type: 'SCHOOL', status: 'ACTIVE' },
      select: { id: true },
    })

    const departmentA = await prisma.organizationUnit.create({
      data: {
        name: `HTTP测试学院A-${suffix}`,
        code: `H-DEPT-A-${suffix}`,
        type: 'DEPARTMENT',
        parentId: school.id,
      },
      select: { id: true },
    })

    const majorA = await prisma.organizationUnit.create({
      data: {
        name: `HTTP测试专业A-${suffix}`,
        code: `H-MAJOR-A-${suffix}`,
        type: 'MAJOR',
        parentId: departmentA.id,
      },
      select: { id: true },
    })

    const classA = await prisma.organizationUnit.create({
      data: {
        name: `HTTP测试班级A-${suffix}`,
        code: `H-CLASS-A-${suffix}`,
        type: 'CLASS',
        parentId: majorA.id,
      },
      select: { id: true },
    })

    const departmentB = await prisma.organizationUnit.create({
      data: {
        name: `HTTP测试学院B-${suffix}`,
        code: `H-DEPT-B-${suffix}`,
        type: 'DEPARTMENT',
        parentId: school.id,
      },
      select: { id: true },
    })

    const majorB = await prisma.organizationUnit.create({
      data: {
        name: `HTTP测试专业B-${suffix}`,
        code: `H-MAJOR-B-${suffix}`,
        type: 'MAJOR',
        parentId: departmentB.id,
      },
      select: { id: true },
    })

    const classB = await prisma.organizationUnit.create({
      data: {
        name: `HTTP测试班级B-${suffix}`,
        code: `H-CLASS-B-${suffix}`,
        type: 'CLASS',
        parentId: majorB.id,
      },
      select: { id: true },
    })

    deptAId = departmentA.id
    classAId = classA.id
    classBId = classB.id

    orgIds.push(departmentA.id, majorA.id, classA.id, departmentB.id, majorB.id, classB.id)

    await createUser('dept-admin', 'DEPARTMENT_ADMIN', deptAId)
    studentId = await createUser('student', 'STUDENT')

    // 学生档案落在 classA：使其具备 STUDENT_SELF 资格（只能协管本班）
    await prisma.studentProfile.create({
      data: { userId: studentId, studentNo: `H-${suffix}-1`, classId: classAId },
    })

    const schoolAdmin = await prisma.user.findFirstOrThrow({
      where: { email: process.env['SUPER_ADMIN_EMAIL'], deletedAt: null },
      select: { email: true },
    })

    schoolToken = await login(schoolAdmin.email, process.env['SUPER_ADMIN_PASSWORD'] ?? '')
    deptToken = await login(`dept-admin-${suffix}@example.test`)
    studentToken = await login(`student-${suffix}@example.test`)
  }, 60_000)

  afterAll(async () => {
    await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } })
    await prisma.userRoleHistory.deleteMany({ where: { userId: { in: userIds } } })
    await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } })
    await prisma.coordinatorQualificationOverride.deleteMany({
      where: { classId: { in: [classAId] } },
    })
    await prisma.counselorClassAssignment.deleteMany({ where: { classId: classAId } })
    await prisma.studentProfile.deleteMany({ where: { userId: { in: userIds } } })
    await prisma.user.deleteMany({ where: { id: { in: userIds } } })

    for (const orgId of [...orgIds].reverse()) {
      await prisma.organizationUnit.delete({ where: { id: orgId } })
    }

    await app.close()
  }, 60_000)

  it('未登录请求任职写接口 → 401', async () => {
    await request(app.getHttpServer())
      .post(`${api}/coordinator/teacher-duties`)
      .send({ teacherId: '00000000-0000-4000-8000-000000000001', classId: classAId })
      .expect(401)
  })

  it('STUDENT 调用任职写接口 → 403', async () => {
    await request(app.getHttpServer())
      .post(`${api}/coordinator/teacher-duties`)
      .set(auth(studentToken))
      .send({ teacherId: '00000000-0000-4000-8000-000000000001', classId: classAId })
      .expect(403)
  })

  it('DEPARTMENT_ADMIN 跨院系创建任职 → 403', async () => {
    await request(app.getHttpServer())
      .post(`${api}/coordinator/counselors`)
      .set(auth(deptToken))
      .send({ userId: studentId, classId: classBId })
      .expect(403)
  })

  it('DEPARTMENT_ADMIN 不能执行特殊覆盖 → 403', async () => {
    await request(app.getHttpServer())
      .post(`${api}/coordinator/overrides`)
      .set(auth(deptToken))
      .send({ userId: studentId, classId: classAId, reason: '越权尝试' })
      .expect(403)
  })

  it('SCHOOL_ADMIN 特殊覆盖缺少原因 → 400', async () => {
    await request(app.getHttpServer())
      .post(`${api}/coordinator/overrides`)
      .set(auth(schoolToken))
      .send({ userId: studentId, classId: classAId, reason: '' })
      .expect(400)
  })

  it('SCHOOL_ADMIN 创建覆盖 → 201，并提升菜单缓存 generation', async () => {
    const versionKey = buildMenuCacheVersionKey()
    const client = redis.getClient()
    const before = Number((await client.get(versionKey)) ?? '0')

    const response = await request(app.getHttpServer())
      .post(`${api}/coordinator/overrides`)
      .set(auth(schoolToken))
      .send({ userId: studentId, classId: classAId, reason: '学院指定学生负责人' })
      .expect(201)

    expect(response.body.data.reason).toBe('学院指定学生负责人')

    const after = Number((await client.get(versionKey)) ?? '0')

    expect(after).toBeGreaterThan(before)

    const eligibility = await request(app.getHttpServer())
      .get(`${api}/coordinator/eligibility`)
      .query({ userId: studentId, classId: classAId })
      .set(auth(schoolToken))
      .expect(200)

    // 学生同时具备本人班级的学生资格与特殊覆盖
    expect(eligibility.body.data.bases).toEqual(
      expect.arrayContaining(['STUDENT_SELF', 'SCHOOL_OVERRIDE']),
    )
  })

  it('覆盖自然到期后资格不再来自覆盖，旧 UserRole 仍保留待清理', async () => {
    const override = await prisma.coordinatorQualificationOverride.findFirstOrThrow({
      where: { userId: studentId, classId: classAId, revokedAt: null },
      select: { id: true },
    })

    // 模拟自然到期：直接把 validUntil 置为刚刚过去，不写 revokedAt
    await prisma.coordinatorQualificationOverride.update({
      where: { id: override.id },
      data: { validUntil: new Date(Date.now() - 1_000) },
    })

    const eligibility = await request(app.getHttpServer())
      .get(`${api}/coordinator/eligibility`)
      .query({ userId: studentId, classId: classAId })
      .set(auth(schoolToken))
      .expect(200)

    // 仅剩学生本人资格，覆盖已失效
    expect(eligibility.body.data.bases).toEqual(['STUDENT_SELF'])

    const activeRole = await prisma.userRole.findFirst({
      where: {
        userId: studentId,
        role: { code: 'CLASS_COORDINATOR' },
        scopeOrgUnitId: classAId,
      },
      select: { id: true },
    })

    // 自然到期不会写数据库：当前授权行仍在，由运行时资格过滤兜底
    expect(activeRole).not.toBeNull()
  })

  it('新增辅导员资格不重复写入授权；撤销后重新分配才产生新的 UserRole', async () => {
    const stale = await prisma.userRole.findFirstOrThrow({
      where: {
        userId: studentId,
        role: { code: 'CLASS_COORDINATOR' },
        scopeOrgUnitId: classAId,
      },
      select: { id: true },
    })

    const counselor = await request(app.getHttpServer())
      .post(`${api}/coordinator/counselors`)
      .set(auth(schoolToken))
      .send({ userId: studentId, classId: classAId })
      .expect(201)

    expect(counselor.body.data.userId).toBe(studentId)

    // 资格来源增加，但正式授权仍只有一条（不会因新增资格重复创建）
    const eligibility = await request(app.getHttpServer())
      .get(`${api}/coordinator/eligibility`)
      .query({ userId: studentId, classId: classAId })
      .set(auth(schoolToken))
      .expect(200)

    expect(eligibility.body.data.bases).toEqual(
      expect.arrayContaining(['STUDENT_SELF', 'COUNSELOR']),
    )

    expect(
      await prisma.userRole.count({
        where: {
          userId: studentId,
          role: { code: 'CLASS_COORDINATOR' },
          scopeOrgUnitId: classAId,
        },
      }),
    ).toBe(1)

    // 显式撤销 → 当前行删除 + MANUAL 历史
    await request(app.getHttpServer())
      .delete(`${api}/role-assignments/${stale.id}`)
      .set(auth(schoolToken))
      .expect(200)

    expect(await prisma.userRole.count({ where: { id: stale.id } })).toBe(0)

    const history = await prisma.userRoleHistory.findFirstOrThrow({
      where: { userRoleId: stale.id },
      select: { revocationReason: true },
    })

    expect(history.revocationReason).toBe('MANUAL')

    // 重新分配才会产生新的授权行
    const newAssignment = await request(app.getHttpServer())
      .post(`${api}/role-assignments`)
      .set(auth(schoolToken))
      .send({
        userId: studentId,
        roleCode: 'CLASS_COORDINATOR',
        scopeOrgUnitId: classAId,
      })
      .expect(201)

    expect(newAssignment.body.data.id).not.toBe(stale.id)
  })

  it('撤销覆盖与辅导员后，资格与授权同步收缩', async () => {
    const override = await prisma.coordinatorQualificationOverride.findFirstOrThrow({
      where: { userId: studentId, classId: classAId, revokedAt: null },
      select: { id: true },
    })

    const counselor = await prisma.counselorClassAssignment.findFirstOrThrow({
      where: { userId: studentId, classId: classAId, revokedAt: null },
      select: { id: true },
    })

    await request(app.getHttpServer())
      .delete(`${api}/coordinator/counselors/${counselor.id}`)
      .set(auth(schoolToken))
      .expect(200)

    await request(app.getHttpServer())
      .delete(`${api}/coordinator/overrides/${override.id}`)
      .set(auth(schoolToken))
      .expect(200)

    const eligibility = await request(app.getHttpServer())
      .get(`${api}/coordinator/eligibility`)
      .query({ userId: studentId, classId: classAId })
      .set(auth(schoolToken))
      .expect(200)

    // 学生本人在籍于该班，仍保留 STUDENT_SELF 资格
    expect(eligibility.body.data).toMatchObject({
      eligible: true,
      bases: ['STUDENT_SELF'],
    })

    const active = await prisma.userRole.count({
      where: {
        userId: studentId,
        role: { code: 'CLASS_COORDINATOR' },
        scopeOrgUnitId: classAId,
      },
    })

    expect(active).toBe(1)
  })

  it('学生个人菜单不因协管员资格变化而丢失', async () => {
    const menus = await request(app.getHttpServer())
      .get(`${api}/menus/current`)
      .set(auth(studentToken))
      .expect(200)

    const serialized = JSON.stringify(menus.body.data)

    expect(serialized).toContain('MY_PROFILE')
    expect(serialized).toContain('DASHBOARD')
  })
})
