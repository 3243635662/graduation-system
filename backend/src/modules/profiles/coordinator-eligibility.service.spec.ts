import { describe, expect, it } from 'vitest'

import type { PrismaService } from '../../prisma/prisma.service.js'
import type { OrganizationService } from '../rbac/organizations/organization.service.js'
import { CoordinatorEligibilityService } from './coordinator-eligibility.service.js'

type Row = Record<string, unknown>

const NOW = new Date()

const CLASSES: Row[] = [
  { id: 'class-1', parentId: 'major-1', type: 'CLASS', status: 'ACTIVE' },
  { id: 'class-2', parentId: 'major-1', type: 'CLASS', status: 'ACTIVE' },
  { id: 'class-3', parentId: 'major-2', type: 'CLASS', status: 'ACTIVE' },
  { id: 'class-disabled', parentId: 'major-1', type: 'CLASS', status: 'DISABLED' },
]

const INACTIVE = new Set<string>()

function createOrgFake() {
  return {
    isPathActive: async (id: string) => !INACTIVE.has(id),
  } as unknown as OrganizationService
}

interface HarnessOptions {
  userStatus?: 'ACTIVE' | 'DISABLED'
  student?: { classId: string | null; enrollmentStatus: string } | null
  teacher?: {
    id: string
    status: string
    personnelProfile?: { status?: string; primaryOrganizationUnitId?: string }
  } | null
  duties?: Array<{
    classId: string
    validUntil: Date | null
    validFrom?: Date
    revokedAt?: Date | null
  }>
  counselors?: Array<{ classId: string; validUntil: Date | null; revokedAt?: Date | null }>
  overrides?: Array<{ classId: string; validUntil: Date | null; revokedAt?: Date | null }>
}

function createPrismaFake(options: HarnessOptions = {}) {
  const userStatus = options.userStatus ?? 'ACTIVE'
  const student = options.student ?? null
  const teacher = options.teacher ?? null
  const duties = options.duties ?? []
  const counselors = options.counselors ?? []
  const overrides = options.overrides ?? []

  const effective = (row: {
    validUntil: Date | null
    validFrom?: Date
    revokedAt?: Date | null
  }) => {
    if (row.revokedAt) return false
    if (row.validFrom && row.validFrom.getTime() > NOW.getTime()) return false
    if (row.validUntil && row.validUntil.getTime() <= NOW.getTime()) return false

    return true
  }

  const prisma = {
    user: {
      async findUnique() {
        return { id: 'user-1', status: userStatus, deletedAt: null }
      },
    },
    studentProfile: {
      async findUnique() {
        return student
      },
    },
    teacherProfile: {
      // 教师身份挂在工作人员档案下，只能通过 personnelProfile.userId 反查
      async findFirst() {
        return teacher
      },
    },
    teacherClassDuty: {
      async findMany({ where }: { where: Row }) {
        if (!teacher || teacher.status !== 'ACTIVE') return []

        const classIds = (where['classId'] as { in: string[] }).in

        return duties
          .filter((row) => classIds.includes(row.classId) && effective(row))
          .map((row) => ({ classId: row.classId, validUntil: row.validUntil }))
      },
    },
    counselorClassAssignment: {
      async findMany({ where }: { where: Row }) {
        const classIds = (where['classId'] as { in: string[] }).in

        return counselors
          .filter((row) => classIds.includes(row.classId) && effective(row))
          .map((row) => ({ classId: row.classId, validUntil: row.validUntil }))
      },
    },
    coordinatorQualificationOverride: {
      async findMany({ where }: { where: Row }) {
        const classIds = (where['classId'] as { in: string[] }).in

        return overrides
          .filter((row) => classIds.includes(row.classId) && effective(row))
          .map((row) => ({ classId: row.classId, validUntil: row.validUntil }))
      },
    },
    organizationUnit: {
      async findMany({ where }: { where: Row }) {
        const ids = (where['id'] as { in: string[] }).in

        return CLASSES.filter((row) => ids.includes(row['id'] as string))
      },
      async findUnique({ where }: { where: { id: string } }) {
        const row = CLASSES.find((item) => item['id'] === where.id)

        return row ? { parentId: row['parentId'] } : null
      },
    },
  }

  return prisma as unknown as PrismaService
}

function createService(options: HarnessOptions = {}) {
  return new CoordinatorEligibilityService(createPrismaFake(options), createOrgFake())
}

describe('CoordinatorEligibilityService.evaluate', () => {
  it('本班在籍学生获得 STUDENT_SELF 资格', async () => {
    const service = createService({
      student: { classId: 'class-1', enrollmentStatus: 'ACTIVE' },
    })

    const result = await service.evaluate('user-1', 'class-1')

    expect(result.eligible).toBe(true)
    expect(result.bases).toEqual(['STUDENT_SELF'])
  })

  it('学生只能协管本人当前班级，同专业其他班也不具备资格', async () => {
    const service = createService({
      student: { classId: 'class-1', enrollmentStatus: 'ACTIVE' },
    })

    expect((await service.evaluate('user-1', 'class-2')).eligible).toBe(false)
    expect((await service.evaluate('user-1', 'class-3')).eligible).toBe(false)
  })

  it('尚未分班的学生不具备任何学生类资格', async () => {
    const service = createService({
      student: { classId: null, enrollmentStatus: 'ACTIVE' },
    })

    expect((await service.evaluate('user-1', 'class-1')).eligible).toBe(false)
  })

  it('休学学生不再具备任何学生类资格', async () => {
    const service = createService({
      student: { classId: 'class-1', enrollmentStatus: 'SUSPENDED' },
    })

    expect((await service.evaluate('user-1', 'class-1')).eligible).toBe(false)
  })

  it('有效班主任任职产生 HEAD_TEACHER 资格并返回最近到期时间', async () => {
    const validUntil = new Date(Date.now() + 86_400_000)
    const service = createService({
      teacher: { id: 'teacher-1', status: 'ACTIVE' },
      duties: [{ classId: 'class-1', validUntil }],
    })

    const result = await service.evaluate('user-1', 'class-1')

    expect(result.bases).toEqual(['HEAD_TEACHER'])
    expect(result.expiresAt?.getTime()).toBe(validUntil.getTime())
  })

  it('离职教师即使存在任职记录也不再具备资格', async () => {
    const service = createService({
      teacher: { id: 'teacher-1', status: 'LEFT' },
      duties: [{ classId: 'class-1', validUntil: null }],
    })

    expect((await service.evaluate('user-1', 'class-1')).eligible).toBe(false)
  })

  it('已撤销或已过期的班主任任职不产生资格', async () => {
    const revoked = createService({
      teacher: { id: 'teacher-1', status: 'ACTIVE' },
      duties: [{ classId: 'class-1', validUntil: null, revokedAt: NOW }],
    })

    const expired = createService({
      teacher: { id: 'teacher-1', status: 'ACTIVE' },
      duties: [{ classId: 'class-1', validUntil: new Date(Date.now() - 1_000) }],
    })

    expect((await revoked.evaluate('user-1', 'class-1')).eligible).toBe(false)
    expect((await expired.evaluate('user-1', 'class-1')).eligible).toBe(false)
  })

  it('有效辅导员分配产生 COUNSELOR 资格，不要求教师档案', async () => {
    const service = createService({
      counselors: [{ classId: 'class-1', validUntil: null }],
    })

    expect((await service.evaluate('user-1', 'class-1')).bases).toEqual(['COUNSELOR'])
  })

  it('有效特殊覆盖产生 SCHOOL_OVERRIDE 资格', async () => {
    const service = createService({
      overrides: [{ classId: 'class-1', validUntil: null }],
    })

    expect((await service.evaluate('user-1', 'class-1')).bases).toEqual(['SCHOOL_OVERRIDE'])
  })

  it('同一用户的多重资格全部返回', async () => {
    const service = createService({
      teacher: { id: 'teacher-1', status: 'ACTIVE' },
      duties: [{ classId: 'class-1', validUntil: null }],
      counselors: [{ classId: 'class-1', validUntil: null }],
      overrides: [{ classId: 'class-1', validUntil: null }],
    })

    const result = await service.evaluate('user-1', 'class-1')

    expect(new Set(result.bases)).toEqual(new Set(['HEAD_TEACHER', 'COUNSELOR', 'SCHOOL_OVERRIDE']))
  })

  it('班级或其祖先停用时所有资格失效', async () => {
    INACTIVE.add('class-disabled')

    const service = createService({
      teacher: { id: 'teacher-1', status: 'ACTIVE' },
      duties: [{ classId: 'class-disabled', validUntil: null }],
    })

    expect((await service.evaluate('user-1', 'class-disabled')).eligible).toBe(false)

    INACTIVE.delete('class-disabled')
  })

  it('账号被禁用时不具备任何资格', async () => {
    const service = createService({
      userStatus: 'DISABLED',
      teacher: { id: 'teacher-1', status: 'ACTIVE' },
      duties: [{ classId: 'class-1', validUntil: null }],
    })

    expect((await service.evaluate('user-1', 'class-1')).eligible).toBe(false)
  })
})

describe('CoordinatorEligibilityService.filterAssignments', () => {
  const assignment = (id: string, roleCode: string, scope: string | null) => ({
    assignmentId: id,
    roleId: `role-${roleCode}`,
    roleCode,
    roleName: roleCode,
    dataScope: 'CLASS' as const,
    scopeOrgUnitId: scope,
    validFrom: new Date(0),
    validUntil: null,
  })

  it('过滤掉失去资格的协管员分配，保留其他角色', async () => {
    const service = createService({
      student: { classId: 'class-1', enrollmentStatus: 'ACTIVE' },
    })

    const result = await service.filterAssignments('user-1', [
      assignment('a-class-1', 'CLASS_COORDINATOR', 'class-1'),
      assignment('a-class-3', 'CLASS_COORDINATOR', 'class-3'),
      assignment('a-student', 'STUDENT', null),
    ])

    expect(result.assignments.map((item) => item.assignmentId)).toEqual(['a-class-1', 'a-student'])
  })

  it('最近资格到期时间参与菜单缓存 TTL 计算', async () => {
    const validUntil = new Date(Date.now() + 60_000)
    const service = createService({
      teacher: { id: 'teacher-1', status: 'ACTIVE' },
      duties: [{ classId: 'class-1', validUntil }],
    })

    const result = await service.filterAssignments('user-1', [
      assignment('a-class-1', 'CLASS_COORDINATOR', 'class-1'),
    ])

    expect(result.nextExpiry?.getTime()).toBe(validUntil.getTime())
  })
})
