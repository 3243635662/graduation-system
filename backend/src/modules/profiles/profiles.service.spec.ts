import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it } from 'vitest'

import type { PrismaService } from '../../prisma/prisma.service.js'
import type { AuditService } from '../audit/audit.service.js'
import type { AuditRecordInput } from '../audit/audit.types.js'
import type { OrganizationService } from '../rbac/organizations/organization.service.js'
import { CoordinatorActorPolicy } from './coordinator-actor-policy.service.js'
import { CoordinatorLifecycleService } from './coordinator-lifecycle.service.js'
import { CounselorClassAssignmentService } from './counselor-class-assignment.service.js'
import { StudentProfileService } from './student-profile.service.js'
import { TeacherClassDutyService } from './teacher-class-duty.service.js'
import { TeacherProfileService } from './teacher-profile.service.js'

type Row = Record<string, unknown>

const ORG_UNITS: Record<string, Row> = {
  'org-dept': {
    id: 'org-dept',
    name: '计算机学院',
    code: 'CS',
    type: 'DEPARTMENT',
    status: 'ACTIVE',
    sortOrder: 1,
    parentId: 'org-school',
    children: [],
  },
  'org-major': {
    id: 'org-major',
    name: '软件工程',
    code: 'SE',
    type: 'MAJOR',
    status: 'ACTIVE',
    sortOrder: 1,
    parentId: 'org-dept',
    children: [],
  },
  'org-class': {
    id: 'org-class',
    name: '软件工程一班',
    code: 'SE-1',
    type: 'CLASS',
    status: 'ACTIVE',
    sortOrder: 1,
    parentId: 'org-major',
    children: [],
  },
  'org-class-2': {
    id: 'org-class-2',
    name: '软件工程二班',
    code: 'SE-2',
    type: 'CLASS',
    status: 'ACTIVE',
    sortOrder: 2,
    parentId: 'org-major',
    children: [],
  },
  'org-class-disabled': {
    id: 'org-class-disabled',
    name: '停用班级',
    code: 'SE-OLD',
    type: 'CLASS',
    status: 'DISABLED',
    sortOrder: 9,
    parentId: 'org-major',
    children: [],
  },
}

/** 停用节点及其下级路径 */
const INACTIVE_ORG_IDS = new Set(['org-class-disabled'])

function createOrganizationFake() {
  return {
    findById: async (id: string) => {
      const unit = ORG_UNITS[id]

      if (!unit) throw new NotFoundException('组织节点不存在')

      return unit
    },
    isPathActive: async (id: string) => !INACTIVE_ORG_IDS.has(id),
  } as unknown as OrganizationService
}

const lifecycleStub = {
  revokeIfIneligible: async () => [],
  invalidateMenus: async () => undefined,
} as unknown as CoordinatorLifecycleService

const actorPolicyStub = {
  assertAllowed: async () => undefined,
} as unknown as CoordinatorActorPolicy

/** 审计写入只关心调用参数，落库行为由 audit.service.spec.ts 覆盖 */
const auditRecords: AuditRecordInput[] = []

const auditStub = {
  record: async (input: AuditRecordInput) => {
    auditRecords.push(input)

    return { id: `audit-${auditRecords.length}`, createdAt: new Date() }
  },
} as unknown as AuditService

function matchesTimeWindow(row: Row, where: Row): boolean {
  if (where['revokedAt'] === null && row['revokedAt'] !== null) return false

  const validFrom = where['validFrom'] as { lte: Date } | undefined

  if (validFrom && (row['validFrom'] as Date).getTime() > validFrom.lte.getTime()) return false

  const or = where['OR'] as Array<{ validUntil: null } | { validUntil: { gt: Date } }> | undefined

  if (or) {
    const validUntil = row['validUntil'] as Date | null

    return or.some((condition) =>
      'validUntil' in condition && condition.validUntil === null
        ? validUntil === null
        : validUntil !== null &&
          validUntil.getTime() >
            (condition as { validUntil: { gt: Date } }).validUntil.gt.getTime(),
    )
  }

  return true
}

function uniqueError(): never {
  throw Object.assign(new Error('unique'), { code: 'P2002' })
}

function createPrismaFake() {
  const users: Row[] = [
    { id: 'user-teacher', status: 'ACTIVE', deletedAt: null },
    { id: 'user-student', status: 'ACTIVE', deletedAt: null },
    { id: 'user-other', status: 'ACTIVE', deletedAt: null },
    { id: 'user-disabled', status: 'DISABLED', deletedAt: null },
  ]

  const studentProfiles: Row[] = []
  const teacherProfiles: Row[] = []
  const duties: Row[] = []
  const counselors: Row[] = []

  let sequence = 0
  const nextId = (prefix: string) => `${prefix}-${++sequence}`

  const findUnique = <T extends Row>(rows: T[], where: Row): T | null => {
    return (
      rows.find((row) => Object.entries(where).every(([key, value]) => row[key] === value)) ?? null
    )
  }

  const withdrawUser = (userId: string) => users.find((user) => user['id'] === userId) ?? null

  const prisma = {
    $transaction: async (callback: (tx: unknown) => unknown) => callback(prisma),
    $queryRaw: async () => [],
    user: {
      async findUnique({ where }: { where: { id: string } }) {
        return withdrawUser(where.id)
      },
    },
    studentProfile: {
      async findUnique({ where }: { where: Row }) {
        return findUnique(studentProfiles, where)
      },
      async findUniqueOrThrow({ where }: { where: Row }) {
        const row = findUnique(studentProfiles, where)

        if (!row) throw new Error('not found')

        return row
      },
      async create({ data }: { data: Row }) {
        if (
          studentProfiles.some((row) => row['studentNo'] === data['studentNo']) ||
          (data['userId'] && studentProfiles.some((row) => row['userId'] === data['userId']))
        ) {
          uniqueError()
        }

        const row = {
          id: nextId('student'),
          enrollmentStatus: 'ACTIVE',
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        }

        studentProfiles.push(row)

        return row
      },
      async update({ where, data }: { where: { id: string }; data: Row }) {
        const row = findUnique(studentProfiles, where)

        if (!row) throw new Error('not found')

        Object.assign(row, data)

        return row
      },
      async findMany({ where }: { where: Row }) {
        return studentProfiles.filter(
          (row) =>
            row['classId'] === where['classId'] &&
            (where['enrollmentStatus']
              ? row['enrollmentStatus'] === where['enrollmentStatus']
              : true),
        )
      },
    },
    studentClassTransfer: {
      async create({ data }: { data: Row }) {
        return { id: nextId('transfer'), transferredAt: new Date(), ...data }
      },
    },
    teacherProfile: {
      async findUnique({ where }: { where: Row }) {
        return findUnique(teacherProfiles, where)
      },
      async create({ data }: { data: Row }) {
        if (
          teacherProfiles.some((row) => row['teacherNo'] === data['teacherNo']) ||
          teacherProfiles.some((row) => row['userId'] === data['userId'])
        ) {
          uniqueError()
        }

        const row = {
          id: nextId('teacher'),
          employmentStatus: 'ACTIVE',
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        }

        teacherProfiles.push(row)

        return row
      },
      async update({ where, data }: { where: { id: string }; data: Row }) {
        const row = findUnique(teacherProfiles, where)

        if (!row) throw new Error('not found')

        Object.assign(row, data)

        return row
      },
      async findMany({ where }: { where: Row }) {
        return teacherProfiles.filter(
          (row) =>
            row['departmentId'] === where['departmentId'] &&
            (where['employmentStatus']
              ? row['employmentStatus'] === where['employmentStatus']
              : true),
        )
      },
    },
    teacherClassDuty: {
      async findUnique({ where }: { where: Row }) {
        return findUnique(duties, where)
      },
      async create({ data }: { data: Row }) {
        const row = {
          id: nextId('duty'),
          revokedAt: null,
          revokedById: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          teacher: { userId: 'user-teacher' },
          ...data,
        }

        duties.push(row)

        return row
      },
      async updateMany({ where, data }: { where: { id: string; revokedAt: null }; data: Row }) {
        const row = findUnique(duties, where)

        if (!row) return { count: 0 }

        Object.assign(row, data)

        return { count: 1 }
      },
      async findUniqueOrThrow({ where }: { where: Row }) {
        const row = findUnique(duties, where)

        if (!row) throw new Error('not found')

        return row
      },
      async findMany({ where }: { where: Row }) {
        return duties.filter(
          (row) => row['classId'] === where['classId'] && matchesTimeWindow(row, where),
        )
      },
    },
    counselorClassAssignment: {
      async findUnique({ where }: { where: Row }) {
        return findUnique(counselors, where)
      },
      async create({ data }: { data: Row }) {
        const row = {
          id: nextId('counselor'),
          revokedAt: null,
          revokedById: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        }

        counselors.push(row)

        return row
      },
      async updateMany({ where, data }: { where: { id: string; revokedAt: null }; data: Row }) {
        const row = findUnique(counselors, where)

        if (!row) return { count: 0 }

        Object.assign(row, data)

        return { count: 1 }
      },
      async findUniqueOrThrow({ where }: { where: Row }) {
        const row = findUnique(counselors, where)

        if (!row) throw new Error('not found')

        return row
      },
      async findMany({ where }: { where: Row }) {
        return counselors.filter(
          (row) =>
            row['classId'] === where['classId'] &&
            (where['userId'] ? row['userId'] === where['userId'] : true) &&
            matchesTimeWindow(row, where),
        )
      },
    },
  }

  return {
    prisma: prisma as unknown as PrismaService,
    students: studentProfiles,
    teachers: teacherProfiles,
    duties,
    counselors,
  }
}

describe('StudentProfileService', () => {
  let fake: ReturnType<typeof createPrismaFake>
  let service: StudentProfileService

  beforeEach(() => {
    fake = createPrismaFake()
    auditRecords.length = 0
    service = new StudentProfileService(
      fake.prisma,
      createOrganizationFake(),
      lifecycleStub,
      auditStub,
    )
  })

  it('允许在没有 User 的情况下建立学生档案', async () => {
    const profile = await service.create(
      { studentNo: '2024001', name: '张三', classId: 'org-class' },
      'actor-1',
    )

    expect(profile.userId).toBeNull()
    expect(profile.studentNo).toBe('2024001')
    expect(profile.createdById).toBe('actor-1')
  })

  it('学生注册后可以绑定已有档案', async () => {
    const profile = await service.create(
      { studentNo: '2024002', name: '李四', classId: 'org-class' },
      'actor-1',
    )

    const bound = await service.bindUser(String(profile.id), 'user-student')

    expect(bound.userId).toBe('user-student')
  })

  it('同一用户不能绑定两个学生档案', async () => {
    const first = await service.create(
      { studentNo: '2024003', name: 'A', classId: 'org-class' },
      'actor-1',
    )
    const second = await service.create(
      { studentNo: '2024004', name: 'B', classId: 'org-class' },
      'actor-1',
    )

    await service.bindUser(String(first.id), 'user-student')

    await expect(service.bindUser(String(second.id), 'user-student')).rejects.toBeInstanceOf(
      ConflictException,
    )
  })

  it('同一档案不能绑定两个用户', async () => {
    const profile = await service.create(
      { studentNo: '2024005', name: 'C', classId: 'org-class' },
      'actor-1',
    )

    await service.bindUser(String(profile.id), 'user-student')

    await expect(service.bindUser(String(profile.id), 'user-other')).rejects.toBeInstanceOf(
      ConflictException,
    )
  })

  it('重复绑定同一用户保持幂等', async () => {
    const profile = await service.create(
      { studentNo: '2024006', name: 'D', classId: 'org-class' },
      'actor-1',
    )

    const first = await service.bindUser(String(profile.id), 'user-student')
    const second = await service.bindUser(String(profile.id), 'user-student')

    expect(second.userId).toBe(first.userId)
  })

  it('classId 必须是 CLASS 类型组织', async () => {
    await expect(
      service.create({ studentNo: '2024007', name: 'E', classId: 'org-major' }, 'actor-1'),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('停用组织不能建立学生档案', async () => {
    await expect(
      service.create({ studentNo: '2024008', name: 'F', classId: 'org-class-disabled' }, 'actor-1'),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('转班校验目标班级有效性', async () => {
    const profile = await service.create(
      { studentNo: '2024009', name: 'G', classId: 'org-class' },
      'actor-1',
    )

    await expect(
      service.transfer(
        String(profile.id),
        'org-class-disabled',
        '转班测试',
        'actor-1',
        'org-class',
      ),
    ).rejects.toBeInstanceOf(BadRequestException)

    const moved = await service.transfer(
      String(profile.id),
      'org-class-2',
      '转班测试',
      'actor-1',
      'org-class',
    )

    expect(moved.classId).toBe('org-class-2')
  })

  it('转班成功后在同一事务写入最小字段审计', async () => {
    const profile = await service.create(
      { studentNo: '2024010', name: 'H', classId: 'org-class' },
      'actor-1',
    )

    await service.transfer(String(profile.id), 'org-class-2', '专业内调整', 'actor-1', 'org-class')

    expect(auditRecords).toHaveLength(1)
    expect(auditRecords[0]).toMatchObject({
      actor: { type: 'USER', userId: 'actor-1' },
      action: 'student.profile.transfer',
      targetType: 'STUDENT_PROFILE',
      targetId: String(profile.id),
      scopeOrgUnitId: 'org-class-2',
      source: 'WEB',
      before: { classId: 'org-class' },
      after: { classId: 'org-class-2' },
      reason: '专业内调整',
    })
  })
})

describe('TeacherProfileService', () => {
  let fake: ReturnType<typeof createPrismaFake>
  let service: TeacherProfileService

  beforeEach(() => {
    fake = createPrismaFake()
    service = new TeacherProfileService(fake.prisma, createOrganizationFake(), lifecycleStub)
  })

  it('departmentId 必须是 DEPARTMENT 类型组织', async () => {
    await expect(
      service.create(
        { userId: 'user-teacher', teacherNo: 'T001', departmentId: 'org-major' },
        'actor-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('创建教师档案并保留所属院系', async () => {
    const profile = await service.create(
      { userId: 'user-teacher', teacherNo: 'T002', departmentId: 'org-dept' },
      'actor-1',
    )

    expect(profile.departmentId).toBe('org-dept')
    expect(profile.employmentStatus).toBe('ACTIVE')
  })

  it('同一用户不能重复建立教师档案', async () => {
    await service.create(
      { userId: 'user-teacher', teacherNo: 'T003', departmentId: 'org-dept' },
      'actor-1',
    )

    await expect(
      service.create(
        { userId: 'user-teacher', teacherNo: 'T004', departmentId: 'org-dept' },
        'actor-1',
      ),
    ).rejects.toBeInstanceOf(ConflictException)
  })
})

describe('TeacherClassDutyService', () => {
  let fake: ReturnType<typeof createPrismaFake>
  let teacherService: TeacherProfileService
  let service: TeacherClassDutyService

  beforeEach(async () => {
    fake = createPrismaFake()
    const organization = createOrganizationFake()
    teacherService = new TeacherProfileService(fake.prisma, organization, lifecycleStub)
    service = new TeacherClassDutyService(fake.prisma, organization, lifecycleStub, actorPolicyStub)

    await teacherService.create(
      { userId: 'user-teacher', teacherNo: 'T100', departmentId: 'org-dept' },
      'actor-1',
    )
  })

  it('班主任任职必须关联有效教师档案', async () => {
    await expect(
      service.assign({ teacherId: 'teacher-missing', classId: 'org-class' }, 'actor-1'),
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('非在职教师不能担任班主任', async () => {
    const teacher = fake.teachers[0]!
    teacher['employmentStatus'] = 'LEFT'

    await expect(
      service.assign({ teacherId: String(teacher['id']), classId: 'org-class' }, 'actor-1'),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('任职班级必须是 CLASS 且路径有效', async () => {
    const teacherId = String(fake.teachers[0]!['id'])

    await expect(
      service.assign({ teacherId, classId: 'org-major' }, 'actor-1'),
    ).rejects.toBeInstanceOf(BadRequestException)

    await expect(
      service.assign({ teacherId, classId: 'org-class-disabled' }, 'actor-1'),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('同一教师可担任多个班级班主任', async () => {
    const teacherId = String(fake.teachers[0]!['id'])

    await service.assign({ teacherId, classId: 'org-class' }, 'actor-1')
    await service.assign({ teacherId, classId: 'org-class-2' }, 'actor-1')

    expect(fake.duties).toHaveLength(2)
  })

  it('提前撤销后历史仍可查询，且默认列表不再返回', async () => {
    const teacherId = String(fake.teachers[0]!['id'])
    const duty = await service.assign({ teacherId, classId: 'org-class' }, 'actor-1')

    await service.revoke(String(duty.id), 'actor-2')

    expect(await service.listByClass('org-class')).toHaveLength(0)

    const history = await service.listByClass('org-class', true)

    expect(history).toHaveLength(1)
    expect(history[0]?.['revokedById']).toBe('actor-2')
    expect(history[0]?.['revokedAt']).toBeInstanceOf(Date)
  })
})

describe('CounselorClassAssignmentService', () => {
  let fake: ReturnType<typeof createPrismaFake>
  let service: CounselorClassAssignmentService

  beforeEach(() => {
    fake = createPrismaFake()
    service = new CounselorClassAssignmentService(
      fake.prisma,
      createOrganizationFake(),
      lifecycleStub,
      actorPolicyStub,
    )
  })

  it('辅导员必须关联有效 User，且不要求教师档案', async () => {
    const assigned = await service.assign({ userId: 'user-other', classId: 'org-class' }, 'actor-1')

    expect(assigned.userId).toBe('user-other')
    expect(fake.teachers).toHaveLength(0)
  })

  it('禁用用户不能成为辅导员', async () => {
    await expect(
      service.assign({ userId: 'user-disabled', classId: 'org-class' }, 'actor-1'),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('一个班级可以有多个辅导员，一人也可以负责多个班级', async () => {
    await service.assign({ userId: 'user-other', classId: 'org-class' }, 'actor-1')
    await service.assign({ userId: 'user-student', classId: 'org-class' }, 'actor-1')
    await service.assign({ userId: 'user-other', classId: 'org-class-2' }, 'actor-1')

    expect(fake.counselors).toHaveLength(3)
  })

  it('撤销后保留历史分配', async () => {
    const assignment = await service.assign(
      { userId: 'user-other', classId: 'org-class' },
      'actor-1',
    )

    await service.revoke(String(assignment.id), 'actor-2')

    expect(await service.listByClass('org-class')).toHaveLength(0)

    const history = await service.listByClass('org-class', true)

    expect(history).toHaveLength(1)
    expect(history[0]?.['revokedById']).toBe('actor-2')
  })
})
