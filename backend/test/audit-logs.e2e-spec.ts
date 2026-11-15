import 'dotenv/config'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { hash } from 'argon2'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { AppModule } from '../src/app.module.js'
import { configureGlobalEnhancers } from '../src/common/configure-global-enhancers.js'
import { AuditService } from '../src/modules/audit/audit.service.js'
import { PrismaService } from '../src/prisma/prisma.service.js'

/**
 * 审计基础设施 E2E
 *
 * 覆盖：未登录 401、无权限 403、试点接口写入字段、分页/筛选、
 * 组织范围隔离、只读路由、事务回滚（审计失败 → 业务回滚）、业务失败不写审计。
 */
describe('审计日志 API (e2e)', () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const password = 'AuditE2E!123'
  const api = '/api'

  let app: INestApplication
  let prisma: PrismaService
  let auditService: AuditService
  let originalRecord: AuditService['record']

  const orgIds: string[] = []
  const userIds: string[] = []
  const profileIds: string[] = []
  const roleIds: string[] = []
  const createdPermissionIds: string[] = []

  let schoolToken: string
  let auditorAToken: string
  let auditorBToken: string
  let plainToken: string

  let auditorAId: string
  let classA1: string
  let classA2: string
  let classB: string

  /** 仅用于回滚用例的故障注入：命中目标时让审计写入抛错 */
  let failAuditForTargetId: string | null = null

  async function createUser(label: string, roleId?: string, scopeOrgUnitId?: string) {
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

    if (roleId) {
      await prisma.userRole.create({
        data: { userId: user.id, roleId, scopeOrgUnitId: scopeOrgUnitId ?? null },
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
  ) {
    const row = await prisma.organizationUnit.create({
      data: { code: `AUD-${code}-${suffix}`, name, type, parentId },
      select: { id: true },
    })

    orgIds.push(row.id)

    return row.id
  }

  async function createProfile(name: string, classId: string) {
    const row = await prisma.studentProfile.create({
      data: { studentNo: `AUD-${suffix}-${profileIds.length + 1}`, name, classId },
      select: { id: true },
    })

    profileIds.push(row.id)

    return row.id
  }

  /** 权限行由 Seed 维护；测试库缺少时补建，结束后只删除测试自己创建的 */
  async function ensurePermission(code: string, moduleName: string, action: string) {
    const existing = await prisma.permission.findUnique({ where: { code }, select: { id: true } })

    if (existing) return existing.id

    const created = await prisma.permission.create({
      data: { code, name: code, moduleName, action, description: 'audit e2e' },
      select: { id: true },
    })

    createdPermissionIds.push(created.id)

    return created.id
  }

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile()

    app = moduleFixture.createNestApplication()
    configureGlobalEnhancers(app)
    app.setGlobalPrefix('api')
    await app.init()

    prisma = app.get(PrismaService)
    auditService = app.get(AuditService)
    originalRecord = auditService.record.bind(auditService)

    // 故障注入：无 SUPER 权限时无法用数据库触发器模拟，改为在唯一写入口抛出
    auditService.record = async (input, tx) => {
      if (failAuditForTargetId && input.targetId === failAuditForTargetId) {
        throw new Error('forced audit failure')
      }

      return originalRecord(input, tx)
    }

    const school = await prisma.organizationUnit.findFirstOrThrow({
      where: { type: 'SCHOOL', status: 'ACTIVE' },
      select: { id: true },
    })

    const deptA = await createOrg('DEPT-A', '审计测试学院A', 'DEPARTMENT', school.id)
    const majorA = await createOrg('MAJOR-A', '审计测试专业A', 'MAJOR', deptA)
    classA1 = await createOrg('CLASS-A1', '审计测试班级A1', 'CLASS', majorA)
    classA2 = await createOrg('CLASS-A2', '审计测试班级A2', 'CLASS', majorA)

    const deptB = await createOrg('DEPT-B', '审计测试学院B', 'DEPARTMENT', school.id)
    const majorB = await createOrg('MAJOR-B', '审计测试专业B', 'MAJOR', deptB)
    classB = await createOrg('CLASS-B', '审计测试班级B', 'CLASS', majorB)

    const auditPermissionId = await ensurePermission('audit:log:read', 'audit', 'log:read')
    const transferPermissionId = await ensurePermission(
      'student:profile:transfer',
      'student',
      'profile:transfer',
    )

    const role = await prisma.role.create({
      data: {
        code: `E2E_AUDIT_READER_${suffix}`,
        name: `审计测试角色 ${suffix}`,
        dataScope: 'MAJOR',
      },
      select: { id: true },
    })

    roleIds.push(role.id)

    await prisma.rolePermission.createMany({
      data: [
        { roleId: role.id, permissionId: auditPermissionId },
        { roleId: role.id, permissionId: transferPermissionId },
      ],
    })

    auditorAId = await createUser('auditor-a', role.id, majorA)
    await createUser('auditor-b', role.id, majorB)
    await createUser('auditor-plain')

    auditorAToken = await login(`auditor-a-${suffix}@example.test`, password)
    auditorBToken = await login(`auditor-b-${suffix}@example.test`, password)
    plainToken = await login(`auditor-plain-${suffix}@example.test`, password)

    const schoolAdmin = await prisma.user.findFirstOrThrow({
      where: { email: process.env['SUPER_ADMIN_EMAIL'], deletedAt: null },
      select: { email: true },
    })

    schoolToken = await login(schoolAdmin.email, process.env['SUPER_ADMIN_PASSWORD'] ?? '')
  }, 120_000)

  afterEach(() => {
    failAuditForTargetId = null
  })

  afterAll(async () => {
    auditService.record = originalRecord

    await prisma.auditLog.deleteMany({ where: { targetId: { in: profileIds } } })
    await prisma.studentClassTransfer.deleteMany({
      where: { studentProfileId: { in: profileIds } },
    })
    await prisma.studentProfile.deleteMany({ where: { id: { in: profileIds } } })
    await prisma.authSession.deleteMany({ where: { userId: { in: userIds } } })
    await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } })
    await prisma.rolePermission.deleteMany({ where: { roleId: { in: roleIds } } })
    await prisma.role.deleteMany({ where: { id: { in: roleIds } } })
    await prisma.permission.deleteMany({ where: { id: { in: createdPermissionIds } } })
    await prisma.user.deleteMany({ where: { id: { in: userIds } } })

    for (const id of [...orgIds].reverse()) {
      await prisma.organizationUnit.delete({ where: { id } })
    }

    await app.close()
  }, 60_000)

  it('未登录查询审计日志 → 401', async () => {
    await request(app.getHttpServer()).get(`${api}/audit-logs`).expect(401)
  })

  it('没有 audit:log:read 权限 → 403', async () => {
    await request(app.getHttpServer())
      .get(`${api}/audit-logs`)
      .set({ Authorization: `Bearer ${plainToken}` })
      .expect(403)
  })

  it('试点转班成功后写入审计：actor/target/before/after/source/requestId 正确', async () => {
    const profileId = await createProfile('审计试点学生', classA1)

    const response = await request(app.getHttpServer())
      .post(`${api}/student-profiles/${profileId}/transfer`)
      .set({ Authorization: `Bearer ${auditorAToken}` })
      .send({ targetClassId: classA2, reason: '审计试点转班' })
      .expect(201)

    const requestId = response.headers['x-request-id'] as string

    expect(requestId).toMatch(/^[0-9a-f-]{36}$/)

    const list = await request(app.getHttpServer())
      .get(`${api}/audit-logs`)
      .query({ targetType: 'STUDENT_PROFILE', targetId: profileId })
      .set({ Authorization: `Bearer ${auditorAToken}` })
      .expect(200)

    expect(list.body.code).toBe(0)
    expect(list.body.data.total).toBe(1)

    const record = list.body.data.list[0]

    expect(record).toMatchObject({
      actorType: 'USER',
      actorUserId: auditorAId,
      action: 'student.profile.transfer',
      targetType: 'STUDENT_PROFILE',
      targetId: profileId,
      scopeOrgUnitId: classA2,
      result: 'SUCCESS',
      source: 'WEB',
      reason: '审计试点转班',
      before: { classId: classA1 },
      after: { classId: classA2 },
    })
    expect(record.requestId).toBe(requestId)
    expect(record.createdAt).toBeTruthy()
  })

  it('分页、时间范围与筛选条件生效', async () => {
    const profileId = profileIds[0]!
    const token = auditorAToken

    // 再转回原班级，形成第二条审计
    await request(app.getHttpServer())
      .post(`${api}/student-profiles/${profileId}/transfer`)
      .set({ Authorization: `Bearer ${token}` })
      .send({ targetClassId: classA1, reason: '审计分页验证' })
      .expect(201)

    const page1 = await request(app.getHttpServer())
      .get(`${api}/audit-logs`)
      .query({ targetId: profileId, page: 1, pageSize: 1 })
      .set({ Authorization: `Bearer ${token}` })
      .expect(200)

    expect(page1.body.data.total).toBe(2)
    expect(page1.body.data.list).toHaveLength(1)

    const page2 = await request(app.getHttpServer())
      .get(`${api}/audit-logs`)
      .query({ targetId: profileId, page: 2, pageSize: 1 })
      .set({ Authorization: `Bearer ${token}` })
      .expect(200)

    expect(page2.body.data.list).toHaveLength(1)
    expect(page2.body.data.list[0].id).not.toBe(page1.body.data.list[0].id)

    const filtered = await request(app.getHttpServer())
      .get(`${api}/audit-logs`)
      .query({
        targetId: profileId,
        action: 'student.profile.transfer',
        targetType: 'STUDENT_PROFILE',
        actorUserId: auditorAId,
        source: 'WEB',
        result: 'SUCCESS',
        from: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        to: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      })
      .set({ Authorization: `Bearer ${token}` })
      .expect(200)

    expect(filtered.body.data.total).toBe(2)

    const outOfRange = await request(app.getHttpServer())
      .get(`${api}/audit-logs`)
      .query({
        targetId: profileId,
        from: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      })
      .set({ Authorization: `Bearer ${token}` })
      .expect(200)

    expect(outOfRange.body.data.total).toBe(0)

    const invalidRange = await request(app.getHttpServer())
      .get(`${api}/audit-logs`)
      .query({
        from: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        to: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      })
      .set({ Authorization: `Bearer ${token}` })
      .expect(400)

    expect(invalidRange.body.code).toBe(40001)
  })

  it('越权组织范围看不到其他专业的审计记录（不泄露资源存在性）', async () => {
    const profileId = profileIds[0]!

    const response = await request(app.getHttpServer())
      .get(`${api}/audit-logs`)
      .query({ targetId: profileId })
      .set({ Authorization: `Bearer ${auditorBToken}` })
      .expect(200)

    expect(response.body.data.total).toBe(0)
    expect(response.body.data.list).toEqual([])

    // 组织范围校验失败关闭：B 审计员不能通过 actorUserId 旁路查询别人的记录
    const byActor = await request(app.getHttpServer())
      .get(`${api}/audit-logs`)
      .query({ actorUserId: auditorAId })
      .set({ Authorization: `Bearer ${auditorBToken}` })
      .expect(200)

    expect(byActor.body.data.total).toBe(0)
  })

  it('审计接口只读：不存在创建、修改、删除路由', async () => {
    const auditId = (
      await prisma.auditLog.findFirstOrThrow({
        where: { targetId: profileIds[0]! },
        select: { id: true },
      })
    ).id

    await request(app.getHttpServer())
      .post(`${api}/audit-logs`)
      .set({ Authorization: `Bearer ${schoolToken}` })
      .send({ action: 'manual.insert' })
      .expect(404)

    await request(app.getHttpServer())
      .patch(`${api}/audit-logs/${auditId}`)
      .set({ Authorization: `Bearer ${schoolToken}` })
      .send({ reason: 'tamper' })
      .expect(404)

    await request(app.getHttpServer())
      .delete(`${api}/audit-logs/${auditId}`)
      .set({ Authorization: `Bearer ${schoolToken}` })
      .expect(404)
  })

  it('审计写入失败时业务变更整体回滚，且不留下成功审计', async () => {
    const profileId = await createProfile('审计回滚学生', classA1)
    failAuditForTargetId = profileId

    await request(app.getHttpServer())
      .post(`${api}/student-profiles/${profileId}/transfer`)
      .set({ Authorization: `Bearer ${auditorAToken}` })
      .send({ targetClassId: classA2, reason: '审计失败回滚' })
      .expect(500)

    const profile = await prisma.studentProfile.findUniqueOrThrow({
      where: { id: profileId },
      select: { classId: true },
    })

    expect(profile.classId).toBe(classA1)
    expect(
      await prisma.studentClassTransfer.count({ where: { studentProfileId: profileId } }),
    ).toBe(0)
    expect(
      await prisma.auditLog.count({
        where: { targetType: 'STUDENT_PROFILE', targetId: profileId },
      }),
    ).toBe(0)
  })

  it('业务失败（跨专业转班 403）不产生审计记录', async () => {
    const profileId = await createProfile('审计越权学生', classA1)

    await request(app.getHttpServer())
      .post(`${api}/student-profiles/${profileId}/transfer`)
      .set({ Authorization: `Bearer ${auditorAToken}` })
      .send({ targetClassId: classB, reason: '跨专业尝试' })
      .expect(403)

    expect(
      await prisma.auditLog.count({
        where: { targetType: 'STUDENT_PROFILE', targetId: profileId },
      }),
    ).toBe(0)
  })
})
