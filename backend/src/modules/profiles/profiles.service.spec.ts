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

/** 撤销/重算资格由 coordinator-lifecycle.service.spec.ts 单独覆盖 */
const lifecycleStub = {
  revokeIfIneligible: async () => [],
  revokeStudentBasisIfOnly: async () => [],
  invalidateMenus: async () => undefined,
} as unknown as CoordinatorLifecycleService

/** 执行人角色校验由 rbac 侧覆盖；这里只验证业务分支 */
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

/** 学生档案列表条件（只覆盖服务实际会拼出的字段） */
function matchesStudentProfileWhere(row: Row, where: Row, users: Row[]): boolean {
  const classId = where['classId']

  if (classId === null) {
    if (row['classId'] !== null) return false
  } else if (classId && typeof classId === 'object') {
    const ids = (classId as { in: string[] }).in

    if (!ids.includes(String(row['classId']))) return false
  }

  if (where['enrollmentStatus'] && row['enrollmentStatus'] !== where['enrollmentStatus']) {
    return false
  }

  if (where['studentNo'] && row['studentNo'] !== where['studentNo']) return false

  const user = users.find((item) => item['id'] === row['userId'])
  const realName = (user?.['realName'] as string | undefined) ?? ''

  if (where['realName']) {
    const expected = (where['realName'] as { contains: string }).contains

    if (!realName.includes(expected)) return false
  }

  const or = where['OR'] as
    | Array<{ studentNo: { contains: string } } | { user: { realName: { contains: string } } }>
    | undefined

  if (or) {
    const studentNo = row['studentNo'] as string

    return or.some((condition) => {
      if ('studentNo' in condition) {
        return studentNo.includes(condition.studentNo.contains)
      }

      return realName.includes(condition.user.realName.contains)
    })
  }

  return true
}

function createPrismaFake() {
  const users: Row[] = [
    {
      id: 'user-teacher',
      realName: '教师甲',
      email: 't@example.test',
      status: 'ACTIVE',
      deletedAt: null,
    },
    {
      id: 'user-student',
      realName: '张三',
      email: 's@example.test',
      status: 'ACTIVE',
      deletedAt: null,
    },
    {
      id: 'user-student-2',
      realName: '李四',
      email: 's2@example.test',
      status: 'ACTIVE',
      deletedAt: null,
    },
    {
      id: 'user-other',
      realName: '王五',
      email: 'o@example.test',
      status: 'ACTIVE',
      deletedAt: null,
    },
    {
      id: 'user-disabled',
      realName: '停用',
      email: 'd@example.test',
      status: 'DISABLED',
      deletedAt: null,
    },
  ]

  const personnelProfiles: Row[] = []
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

  const prisma = {
    $transaction: async (callback: (tx: unknown) => unknown) => callback(prisma),
    $queryRaw: async () => [],
    user: {
      async findUnique({ where }: { where: { id: string } }) {
        return users.find((user) => user['id'] === where.id) ?? null
      },
    },
    personnelProfile: {
      async findUnique({ where }: { where: Row }) {
        return findUnique(personnelProfiles, where)
      },
      async create({ data }: { data: Row }) {
        if (personnelProfiles.some((row) => row['userId'] === data['userId'])) uniqueError()

        const row = {
          id: nextId('personnel'),
          status: 'ACTIVE',
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        }

        personnelProfiles.push(row)

        return row
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
      async count({ where }: { where: Row }) {
        return studentProfiles.filter((row) => matchesStudentProfileWhere(row, where, users)).length
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
          classId: null,
          enrollmentYear: null,
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
        return studentProfiles
          .filter((row) => matchesStudentProfileWhere(row, where, users))
          .map((row) => {
            const user = users.find((item) => item['id'] === row['userId'])!
            const classId = row['classId'] as string | null
            const klass = classId ? ORG_UNITS[classId] : undefined
            const parentId = klass?.['parentId'] as string | undefined
            const parent = parentId ? ORG_UNITS[parentId] : undefined

            return {
              ...row,
              user: {
                realName: user['realName'],
                email: user['email'],
                status: user['status'],
              },
              class: klass
                ? {
                    id: klass['id'],
                    name: klass['name'],
                    parent: parent
                      ? { id: parent['id'], name: parent['name'], type: parent['type'] }
                      : null,
                  }
                : null,
            }
          })
      },
    },
    studentClassTransfer: {
      async create({ data }: { data: Row }) {
        return { id: nextId('transfer'), transferredAt: new Date(), ...data }
      },
    },
    teacherProfile: {
      async findUnique({ where }: { where: Row }) {
        const row = findUnique(teacherProfiles, where)

        if (!row) return null

        // 教师身份挂在工作人员档案下：账号通过 personnelProfile.userId 取得
        const personnel = personnelProfiles.find((item) => item['id'] === row['personnelProfileId'])

        return {
          ...row,
          personnelProfile: personnel
            ? {
                userId: personnel['userId'],
                status: personnel['status'],
                primaryOrganizationUnitId: personnel['primaryOrganizationUnitId'],
              }
            : null,
        }
      },
      async findFirst({ where }: { where: Row }) {
        const personnelId = (where['personnelProfile'] as { userId?: string } | undefined)?.userId

        if (!personnelId) return null

        return (
          teacherProfiles.find((row) => {
            const personnel = personnelProfiles.find(
              (item) => item['id'] === row['personnelProfileId'],
            )

            return personnel?.['userId'] === personnelId
          }) ?? null
        )
      },
      async create({ data }: { data: Row }) {
        if (
          teacherProfiles.some((row) => row['teacherNo'] === data['teacherNo']) ||
          teacherProfiles.some((row) => row['personnelProfileId'] === data['personnelProfileId'])
        ) {
          uniqueError()
        }

        const row = {
          id: nextId('teacher'),
          status: 'ACTIVE',
          title: null,
          professionalInfo: null,
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
    },
    teacherClassDuty: {
      async findUnique({ where }: { where: Row }) {
        const row = findUnique(duties, where)

        if (!row) return null

        // revoke() 需要从任职记录回溯到账号，用于重算协管员资格
        const teacher = teacherProfiles.find((item) => item['id'] === row['teacherId'])
        const personnel = personnelProfiles.find(
          (item) => item['id'] === teacher?.['personnelProfileId'],
        )

        return { ...row, teacher: { personnelProfile: { userId: personnel?.['userId'] } } }
      },
      async create({ data }: { data: Row }) {
        const row = {
          id: nextId('duty'),
          dutyType: 'HEAD_TEACHER',
          revokedAt: null,
          revokedById: null,
          createdAt: new Date(),
          updatedAt: new Date(),
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
          (row) =>
            row['classId'] === where['classId'] &&
            (where['teacherId'] ? row['teacherId'] === where['teacherId'] : true) &&
            (where['dutyType'] ? row['dutyType'] === where['dutyType'] : true) &&
            matchesTimeWindow(row, where),
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
    users,
    personnelProfiles,
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

  it('必须先有账号才能建立学生档案，姓名取 User.realName', async () => {
    const profile = await service.create(
      { userId: 'user-student', studentNo: '2024001', classId: 'org-class' },
      'actor-1',
    )

    expect(profile.userId).toBe('user-student')
    expect(profile.studentNo).toBe('2024001')
    expect(profile.createdById).toBe('actor-1')
    // 档案不再保存第二份姓名
    expect(profile).not.toHaveProperty('name')
  })

  it('未分班学生可以正常建档，classId 为 null', async () => {
    const profile = await service.create(
      { userId: 'user-student', studentNo: '2024002' },
      'actor-1',
    )

    expect(profile.classId).toBeNull()
    expect(profile.userId).toBe('user-student')
  })

  it('绑定的账号不存在时返回 404', async () => {
    await expect(
      service.create({ userId: 'user-missing', studentNo: '2024003' }, 'actor-1'),
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('绑定账号被禁用时返回 400', async () => {
    await expect(
      service.create({ userId: 'user-disabled', studentNo: '2024004' }, 'actor-1'),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('同一用户不能重复建立学生档案', async () => {
    await service.create({ userId: 'user-student', studentNo: '2024005' }, 'actor-1')

    await expect(
      service.create({ userId: 'user-student', studentNo: '2024006' }, 'actor-1'),
    ).rejects.toBeInstanceOf(ConflictException)
  })

  it('学号重复时返回 409', async () => {
    await service.create({ userId: 'user-student', studentNo: '2024007' }, 'actor-1')

    await expect(
      service.create({ userId: 'user-student-2', studentNo: '2024007' }, 'actor-1'),
    ).rejects.toBeInstanceOf(ConflictException)
  })

  it('classId 必须是 CLASS 类型组织', async () => {
    await expect(
      service.create(
        { userId: 'user-student', studentNo: '2024008', classId: 'org-major' },
        'actor-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('停用组织不能建立学生档案', async () => {
    await expect(
      service.create(
        { userId: 'user-student', studentNo: '2024009', classId: 'org-class-disabled' },
        'actor-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('列表包含未分班学生，unassignedOnly 可筛出未分班学生', async () => {
    await service.create(
      { userId: 'user-student', studentNo: '2024010', classId: 'org-class' },
      'actor-1',
    )
    await service.create({ userId: 'user-student-2', studentNo: '2024011' }, 'actor-1')

    const all = await service.list({ classIds: ['org-class'], page: 1, pageSize: 10 })

    expect(all.total).toBe(1)
    expect(all.list[0]).toMatchObject({
      studentNo: '2024010',
      realName: '张三',
      className: '软件工程一班',
      majorName: '软件工程',
    })

    const unassigned = await service.list({
      classIds: ['org-class'],
      page: 1,
      pageSize: 10,
      unassignedOnly: true,
    })

    expect(unassigned.total).toBe(1)
    expect(unassigned.list[0]).toMatchObject({
      studentNo: '2024011',
      classId: null,
      className: null,
    })
  })

  it('转班校验目标班级有效性', async () => {
    const profile = await service.create(
      { userId: 'user-student', studentNo: '2024012', classId: 'org-class' },
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
      { userId: 'user-student', studentNo: '2024013', classId: 'org-class' },
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

  it('未分班学生首次分班写入 assign-class 审计', async () => {
    const profile = await service.create(
      { userId: 'user-student', studentNo: '2024014' },
      'actor-1',
    )

    await service.changeClass(String(profile.id), 'org-class', '新生分班', 'actor-1')

    expect(auditRecords[0]).toMatchObject({
      action: 'student.profile.assign_class',
      before: { classId: null },
      after: { classId: 'org-class' },
      reason: '新生分班',
    })
  })

  it('分班/转班原因不能为空', async () => {
    const profile = await service.create(
      { userId: 'user-student', studentNo: '2024015', classId: 'org-class' },
      'actor-1',
    )

    await expect(
      service.changeClass(String(profile.id), 'org-class-2', '   ', 'actor-1'),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('已经在目标班级时不做变更', async () => {
    const profile = await service.create(
      { userId: 'user-student', studentNo: '2024016', classId: 'org-class' },
      'actor-1',
    )

    await expect(
      service.changeClass(String(profile.id), 'org-class', '重复分班', 'actor-1'),
    ).rejects.toBeInstanceOf(BadRequestException)
  })
})

describe('TeacherProfileService', () => {
  let fake: ReturnType<typeof createPrismaFake>
  let service: TeacherProfileService

  beforeEach(async () => {
    fake = createPrismaFake()
    service = new TeacherProfileService(fake.prisma, createOrganizationFake(), lifecycleStub)

    await fake.prisma.personnelProfile.create({
      data: { userId: 'user-teacher', primaryOrganizationUnitId: 'org-dept' },
    })
  })

  function personnelId(): string {
    return String(fake.personnelProfiles[0]!['id'])
  }

  it('必须基于已存在的工作人员档案创建教师身份', async () => {
    await expect(
      service.create({ personnelProfileId: 'personnel-missing', teacherNo: 'T001' }, 'actor-1'),
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('创建教师身份并保留工作人员档案关联', async () => {
    const profile = await service.create(
      { personnelProfileId: personnelId(), teacherNo: 'T002' },
      'actor-1',
    )

    expect(profile.personnelProfileId).toBe(personnelId())
    expect(profile.status).toBe('ACTIVE')
    expect(profile.createdById).toBe('actor-1')
  })

  it('同一工作人员不能重复建立教师身份', async () => {
    await service.create({ personnelProfileId: personnelId(), teacherNo: 'T003' }, 'actor-1')

    await expect(
      service.create({ personnelProfileId: personnelId(), teacherNo: 'T004' }, 'actor-1'),
    ).rejects.toBeInstanceOf(ConflictException)
  })

  it('教师编号重复时返回 409', async () => {
    await fake.prisma.personnelProfile.create({
      data: { userId: 'user-other', primaryOrganizationUnitId: 'org-dept' },
    })

    await service.create({ personnelProfileId: personnelId(), teacherNo: 'T005' }, 'actor-1')

    await expect(
      service.create(
        { personnelProfileId: String(fake.personnelProfiles[1]!['id']), teacherNo: 'T005' },
        'actor-1',
      ),
    ).rejects.toBeInstanceOf(ConflictException)
  })
})

describe('TeacherClassDutyService', () => {
  let fake: ReturnType<typeof createPrismaFake>
  let service: TeacherClassDutyService

  beforeEach(async () => {
    fake = createPrismaFake()
    const organization = createOrganizationFake()
    const teacherService = new TeacherProfileService(fake.prisma, organization, lifecycleStub)
    service = new TeacherClassDutyService(fake.prisma, organization, lifecycleStub, actorPolicyStub)

    await fake.prisma.personnelProfile.create({
      data: { userId: 'user-teacher', primaryOrganizationUnitId: 'org-dept' },
    })

    await teacherService.create(
      { personnelProfileId: String(fake.personnelProfiles[0]!['id']), teacherNo: 'T100' },
      'actor-1',
    )
  })

  it('班主任任职必须关联有效教师档案', async () => {
    await expect(
      service.assign({ teacherId: 'teacher-missing', classId: 'org-class' }, 'actor-1'),
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('非在职教师不能担任班主任', async () => {
    fake.teachers[0]!['status'] = 'LEFT'

    await expect(
      service.assign(
        { teacherId: String(fake.teachers[0]!['id']), classId: 'org-class' },
        'actor-1',
      ),
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

  it('同一教师同一班级时间重叠时返回 409', async () => {
    const teacherId = String(fake.teachers[0]!['id'])

    await service.assign({ teacherId, classId: 'org-class' }, 'actor-1')

    await expect(
      service.assign({ teacherId, classId: 'org-class' }, 'actor-1'),
    ).rejects.toBeInstanceOf(ConflictException)
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
