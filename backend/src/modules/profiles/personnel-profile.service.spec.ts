import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it } from 'vitest'

import type { PrismaService } from '../../prisma/prisma.service.js'
import type { OrganizationService } from '../rbac/organizations/organization.service.js'
import type { CoordinatorLifecycleService } from './coordinator-lifecycle.service.js'
import { PersonnelProfileService } from './personnel-profile.service.js'

type Row = Record<string, unknown>

const ORG_UNITS: Record<string, Row> = {
  'org-school': {
    id: 'org-school',
    name: '示例大学',
    code: 'U',
    type: 'SCHOOL',
    status: 'ACTIVE',
    sortOrder: 0,
    parentId: null,
    children: [],
  },
  'org-dept-a': {
    id: 'org-dept-a',
    name: '计算机学院',
    code: 'CS',
    type: 'DEPARTMENT',
    status: 'ACTIVE',
    sortOrder: 1,
    parentId: 'org-school',
    children: [],
  },
  'org-major-a': {
    id: 'org-major-a',
    name: '软件工程',
    code: 'SE',
    type: 'MAJOR',
    status: 'ACTIVE',
    sortOrder: 1,
    parentId: 'org-dept-a',
    children: [],
  },
  'org-class-a': {
    id: 'org-class-a',
    name: '软件工程一班',
    code: 'SE-1',
    type: 'CLASS',
    status: 'ACTIVE',
    sortOrder: 1,
    parentId: 'org-major-a',
    children: [],
  },
  'org-dept-b': {
    id: 'org-dept-b',
    name: '外国语学院',
    code: 'FL',
    type: 'DEPARTMENT',
    status: 'ACTIVE',
    sortOrder: 2,
    parentId: 'org-school',
    children: [],
  },
  'org-major-b': {
    id: 'org-major-b',
    name: '英语',
    code: 'EN',
    type: 'MAJOR',
    status: 'ACTIVE',
    sortOrder: 1,
    parentId: 'org-dept-b',
    children: [],
  },
  'org-class-b': {
    id: 'org-class-b',
    name: '英语一班',
    code: 'EN-1',
    type: 'CLASS',
    status: 'ACTIVE',
    sortOrder: 1,
    parentId: 'org-major-b',
    children: [],
  },
}

const SUBTREES: Record<string, string[]> = {
  'org-school': Object.keys(ORG_UNITS),
  'org-dept-a': ['org-dept-a', 'org-major-a', 'org-class-a'],
  'org-major-a': ['org-major-a', 'org-class-a'],
  'org-class-a': ['org-class-a'],
  'org-dept-b': ['org-dept-b', 'org-major-b', 'org-class-b'],
  'org-major-b': ['org-major-b', 'org-class-b'],
  'org-class-b': ['org-class-b'],
}

function createOrganizationFake() {
  return {
    findById: async (id: string) => {
      const unit = ORG_UNITS[id]

      if (!unit) throw new NotFoundException('组织节点不存在')

      return unit
    },
    isPathActive: async (id: string) => Boolean(ORG_UNITS[id]),
    getSubtreeIds: async (id: string) => SUBTREES[id] ?? [],
  } as unknown as OrganizationService
}

function uniqueError(): never {
  throw Object.assign(new Error('unique'), { code: 'P2002' })
}

interface ListArgs {
  where?: Row
}

function createPrismaFake() {
  const users: Row[] = [
    { id: 'user-1', status: 'ACTIVE', deletedAt: null, realName: '张三', email: 'a@example.test' },
    { id: 'user-2', status: 'ACTIVE', deletedAt: null, realName: '李四', email: 'b@example.test' },
    { id: 'user-disabled', status: 'DISABLED', deletedAt: null, realName: '停用', email: 'c@test' },
  ]

  const personnel: Row[] = []
  const teachers: Row[] = []
  const duties: Row[] = []
  const userRoles: Row[] = []
  const listArgs: ListArgs = {}

  let sequence = 0
  const nextId = (prefix: string) => `${prefix}-${++sequence}`

  const teacherOf = (row: Row) =>
    teachers.find((item) => item['personnelProfileId'] === row['id']) ?? null

  const userOf = (row: Row) => users.find((item) => item['id'] === row['userId']) ?? null

  /** 关系字段一次性补齐，模拟 select 后的返回结构 */
  const enrich = (row: Row): Row => ({
    ...row,
    user: userOf(row),
    primaryOrganization: ORG_UNITS[row['primaryOrganizationUnitId'] as string],
    teacherProfile: teacherOf(row),
    createdBy: null,
    updatedBy: null,
  })

  const personnelApi = {
    async findUnique({ where }: { where: Row }) {
      const row = personnel.find((item) =>
        where['id'] === undefined ? item['userId'] === where['userId'] : item['id'] === where['id'],
      )

      return row ? enrich(row) : null
    },
    async create({ data }: { data: Row }) {
      if (
        (data['employeeNo'] && personnel.some((row) => row['employeeNo'] === data['employeeNo'])) ||
        personnel.some((row) => row['userId'] === data['userId'])
      ) {
        uniqueError()
      }

      const row = {
        id: nextId('personnel'),
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      }

      personnel.push(row)

      return row
    },
    async update({ where, data }: { where: Row; data: Row }) {
      const row = personnel.find((item) => item['id'] === where['id'])

      if (!row) throw new Error('not found')

      Object.assign(row, data)

      return row
    },
    async count({ where }: { where: Row }) {
      const scope = (where['primaryOrganizationUnitId'] as { in?: string[] } | undefined)?.in ?? []

      return personnel.filter((row) => scope.includes(row['primaryOrganizationUnitId'] as string))
        .length
    },
    async findMany({ where }: { where: Row }) {
      listArgs.where = where

      const scope = (where['primaryOrganizationUnitId'] as { in?: string[] } | undefined)?.in ?? []

      return personnel
        .filter((row) => scope.includes(row['primaryOrganizationUnitId'] as string))
        .map((row) => ({
          ...row,
          primaryOrganization: ORG_UNITS[row['primaryOrganizationUnitId'] as string],
          user: userOf(row),
          teacherProfile: teacherOf(row),
        }))
    },
  }

  const tx = {
    personnelProfile: personnelApi,
    teacherProfile: {
      async update({ where, data }: { where: Row; data: Row }) {
        const row = teachers.find((item) => item['id'] === where['id'])

        if (!row) throw new Error('not found')

        Object.assign(row, data)

        return row
      },
    },
    userRole: {
      async findMany({ where }: { where: Row }) {
        return userRoles.filter(
          (row) => row['userId'] === where['userId'] && row['scopeOrgUnitId'] !== null,
        )
      },
    },
    $queryRaw: async () => [],
  }

  const prisma = {
    user: {
      async findUnique({ where }: { where: Row }) {
        return users.find((item) => item['id'] === where['id']) ?? null
      },
    },
    personnelProfile: personnelApi,
    teacherClassDuty: {
      async count({ where }: { where: Row }) {
        const excluded = (where['classId'] as { notIn?: string[] } | undefined)?.notIn ?? []

        return duties.filter(
          (row) =>
            row['teacherId'] === where['teacherId'] && !excluded.includes(row['classId'] as string),
        ).length
      },
    },
    $transaction: async <T>(fn: (client: typeof tx) => Promise<T>): Promise<T> => fn(tx),
  }

  return {
    prisma: prisma as unknown as PrismaService,
    personnel,
    teachers,
    duties,
    userRoles,
    listArgs,
  }
}

describe('PersonnelProfileService', () => {
  let fake: ReturnType<typeof createPrismaFake>
  let service: PersonnelProfileService
  let revokeCalls: Array<{ userId: string; classId: string }>
  let invalidations: string[]

  beforeEach(() => {
    fake = createPrismaFake()
    revokeCalls = []
    invalidations = []

    const lifecycle = {
      revokeIfIneligible: async (userId: string, classId: string) => {
        revokeCalls.push({ userId, classId })

        return []
      },
      invalidateMenus: async (reason: string) => {
        invalidations.push(reason)
      },
    } as unknown as CoordinatorLifecycleService

    service = new PersonnelProfileService(fake.prisma, createOrganizationFake(), lifecycle)
  })

  it('创建档案：工号与岗位去空格，写入创建人', async () => {
    const created = await service.create(
      {
        userId: 'user-1',
        employeeNo: ' E001 ',
        primaryOrganizationUnitId: 'org-dept-a',
        positionName: ' 研究生秘书 ',
      },
      'actor-1',
    )

    expect(created.employeeNo).toBe('E001')
    expect(created.positionName).toBe('研究生秘书')
    expect(created.createdById).toBe('actor-1')
    expect(created.status).toBe('ACTIVE')
  })

  it('创建档案：同一用户已有档案时冲突', async () => {
    await service.create({ userId: 'user-1', primaryOrganizationUnitId: 'org-dept-a' }, 'actor-1')

    await expect(
      service.create({ userId: 'user-1', primaryOrganizationUnitId: 'org-dept-b' }, 'actor-1'),
    ).rejects.toBeInstanceOf(ConflictException)
  })

  it('创建档案：正式组织不能是班级', async () => {
    await expect(
      service.create({ userId: 'user-1', primaryOrganizationUnitId: 'org-class-a' }, 'actor-1'),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('创建档案：组织节点不存在', async () => {
    await expect(
      service.create({ userId: 'user-1', primaryOrganizationUnitId: 'org-missing' }, 'actor-1'),
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('创建档案：工号唯一冲突映射为 409', async () => {
    fake.personnel.push({
      id: 'personnel-existing',
      userId: 'user-2',
      employeeNo: 'E009',
      primaryOrganizationUnitId: 'org-dept-a',
      status: 'ACTIVE',
    })

    await expect(
      service.create(
        { userId: 'user-1', employeeNo: 'E009', primaryOrganizationUnitId: 'org-dept-a' },
        'actor-1',
      ),
    ).rejects.toBeInstanceOf(ConflictException)
  })

  it('修改档案：换组织时教师仍有跨组织有效班主任任职则冲突', async () => {
    fake.personnel.push({
      id: 'personnel-1',
      userId: 'user-1',
      primaryOrganizationUnitId: 'org-dept-a',
      status: 'ACTIVE',
    })
    fake.teachers.push({ id: 'teacher-1', personnelProfileId: 'personnel-1', status: 'ACTIVE' })
    fake.duties.push({ id: 'duty-1', teacherId: 'teacher-1', classId: 'org-class-a' })

    await expect(
      service.updateBasic('personnel-1', { primaryOrganizationUnitId: 'org-dept-b' }, 'actor-1'),
    ).rejects.toBeInstanceOf(ConflictException)
  })

  it('修改档案：不换组织时不检查班主任任职', async () => {
    fake.personnel.push({
      id: 'personnel-1',
      userId: 'user-1',
      primaryOrganizationUnitId: 'org-dept-a',
      positionName: null,
      status: 'ACTIVE',
    })
    fake.teachers.push({ id: 'teacher-1', personnelProfileId: 'personnel-1', status: 'ACTIVE' })
    fake.duties.push({ id: 'duty-1', teacherId: 'teacher-1', classId: 'org-class-a' })

    const updated = await service.updateBasic('personnel-1', { positionName: '系主任' }, 'actor-1')

    expect(updated.positionName).toBe('系主任')
    expect(updated.primaryOrganizationUnitId).toBe('org-dept-a')
  })

  it('修改档案：档案不存在返回 404', async () => {
    await expect(service.updateBasic('personnel-missing', {}, 'actor-1')).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })

  it('修改状态：同步教师身份并重算班级协管资格', async () => {
    fake.personnel.push({
      id: 'personnel-1',
      userId: 'user-1',
      primaryOrganizationUnitId: 'org-dept-a',
      status: 'ACTIVE',
    })
    fake.teachers.push({ id: 'teacher-1', personnelProfileId: 'personnel-1', status: 'ACTIVE' })
    fake.userRoles.push({
      userId: 'user-1',
      roleCode: 'CLASS_COORDINATOR',
      scopeOrgUnitId: 'org-class-a',
    })

    const updated = await service.updateStatus('personnel-1', 'LEFT', 'actor-1')

    expect(updated.status).toBe('LEFT')
    expect(fake.teachers[0]?.['status']).toBe('LEFT')
    expect(revokeCalls).toEqual([{ userId: 'user-1', classId: 'org-class-a' }])
    expect(invalidations).toEqual(['personnel.status'])
  })

  it('列表：组织范围下推到 where，并返回教师身份摘要', async () => {
    fake.personnel.push(
      {
        id: 'personnel-1',
        userId: 'user-1',
        employeeNo: 'E001',
        positionName: '教授',
        primaryOrganizationUnitId: 'org-dept-a',
        status: 'ACTIVE',
        updatedAt: new Date(),
      },
      {
        id: 'personnel-2',
        userId: 'user-2',
        employeeNo: 'E002',
        positionName: null,
        primaryOrganizationUnitId: 'org-dept-b',
        status: 'ACTIVE',
        updatedAt: new Date(),
      },
    )
    fake.teachers.push({
      id: 'teacher-1',
      personnelProfileId: 'personnel-1',
      teacherNo: 'T001',
      title: '副教授',
      status: 'ACTIVE',
    })

    const result = await service.list({
      organizationIds: ['org-dept-a'],
      page: 1,
      pageSize: 10,
    })

    expect(fake.listArgs.where?.['primaryOrganizationUnitId']).toEqual({
      in: ['org-dept-a'],
    })
    expect(result.total).toBe(1)
    expect(result.list[0]).toMatchObject({
      id: 'personnel-1',
      organizationId: 'org-dept-a',
      organizationName: '计算机学院',
      organizationType: 'DEPARTMENT',
      realName: '张三',
      accountStatus: 'ACTIVE',
      isTeacher: true,
      teacherNo: 'T001',
      title: '副教授',
    })
  })

  it('列表：teacherOnly 只保留有教师身份的工作人员', async () => {
    await service.list({
      organizationIds: ['org-dept-a'],
      page: 1,
      pageSize: 10,
      teacherOnly: true,
      keyword: '张',
      realName: '张',
    })

    expect(fake.listArgs.where?.['teacherProfile']).toEqual({ isNot: null })
    expect(fake.listArgs.where?.['AND']).toBeDefined()
  })

  it('详情：返回账号摘要、正式组织与教师身份', async () => {
    fake.personnel.push({
      id: 'personnel-1',
      userId: 'user-1',
      employeeNo: 'E001',
      positionName: '教授',
      primaryOrganizationUnitId: 'org-dept-a',
      status: 'ACTIVE',
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    fake.teachers.push({
      id: 'teacher-1',
      personnelProfileId: 'personnel-1',
      teacherNo: 'T001',
      title: '副教授',
      status: 'ACTIVE',
    })

    const detail = await service.findDetail('personnel-1')

    expect(detail.employeeNo).toBe('E001')
    expect(detail.organization).toMatchObject({ id: 'org-dept-a', type: 'DEPARTMENT' })
    expect(detail.teacherProfile).toMatchObject({ teacherNo: 'T001' })
  })

  it('详情：档案不存在返回 404', async () => {
    await expect(service.findDetail('personnel-missing')).rejects.toBeInstanceOf(NotFoundException)
  })
})
