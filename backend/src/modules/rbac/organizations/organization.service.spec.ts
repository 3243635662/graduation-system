import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { beforeEach, describe, expect, it } from 'vitest'

import type { OrganizationType } from '../../../../generated/prisma/client.js'
import type { PrismaService } from '../../../prisma/prisma.service.js'
import { OrganizationService } from './organization.service.js'
import { buildOrganizationTree, type OrganizationRow } from './organization.types.js'

interface FakeRow extends OrganizationRow {
  createdById?: string | null
}

function row(partial: Partial<FakeRow> & Pick<FakeRow, 'id' | 'code' | 'type'>): FakeRow {
  return {
    name: partial.code,
    status: 'ACTIVE',
    sortOrder: 0,
    parentId: null,
    ...partial,
  }
}

const SCHOOL = row({
  id: 'org-school',
  code: 'SCHOOL',
  type: 'SCHOOL',
  name: '示范大学',
  sortOrder: 0,
})
const DEPARTMENT_CS = row({
  id: 'org-cs',
  code: 'CS',
  type: 'DEPARTMENT',
  name: '计算机学院',
  parentId: SCHOOL.id,
  sortOrder: 1,
})
const DEPARTMENT_ECON = row({
  id: 'org-econ',
  code: 'ECON',
  type: 'DEPARTMENT',
  name: '经济管理学院',
  parentId: SCHOOL.id,
  sortOrder: 2,
})
const MAJOR_SE = row({
  id: 'org-se',
  code: 'SE',
  type: 'MAJOR',
  name: '软件工程',
  parentId: DEPARTMENT_CS.id,
})
const CLASS_SE_1 = row({
  id: 'org-se-1',
  code: 'SE-2401',
  type: 'CLASS',
  name: '软件工程一班',
  parentId: MAJOR_SE.id,
})
const CLASS_SE_2 = row({
  id: 'org-se-2',
  code: 'SE-2402',
  type: 'CLASS',
  name: '软件工程二班',
  parentId: MAJOR_SE.id,
})

/** 按 where 子集过滤；只实现被测代码实际用到的最小语义 */
function matches(candidate: FakeRow, where: Record<string, unknown> = {}): boolean {
  for (const [key, value] of Object.entries(where)) {
    if (value === undefined) continue

    if (key === 'parentId' && value !== null && typeof value === 'object' && 'in' in value) {
      const ids = (value as { in: string[] }).in

      if (candidate.parentId === null || !ids.includes(candidate.parentId)) return false

      continue
    }

    if (candidate[key as keyof FakeRow] !== value) return false
  }

  return true
}

function createFakePrisma(seed: FakeRow[]) {
  const rows = seed.map((item) => ({ ...item }))
  let sequence = seed.length

  const prisma = {
    organizationUnit: {
      async findMany({ where }: { where?: Record<string, unknown> } = {}) {
        return rows.filter((candidate) => matches(candidate, where)).map((item) => ({ ...item }))
      },
      async findFirst({ where }: { where?: Record<string, unknown> } = {}) {
        const found = rows.find((candidate) => matches(candidate, where))

        return found ? { ...found } : null
      },
      async findUnique({ where }: { where: { id?: string; code?: string } }) {
        const found = rows.find((candidate) =>
          where.id ? candidate.id === where.id : candidate.code === where.code,
        )

        return found ? { ...found } : null
      },
      async count({ where }: { where?: Record<string, unknown> } = {}) {
        return rows.filter((candidate) => matches(candidate, where)).length
      },
      async create({ data }: { data: Record<string, unknown> }) {
        const created: FakeRow = {
          id: `org-created-${++sequence}`,
          name: String(data['name']),
          code: String(data['code']),
          type: data['type'] as OrganizationType,
          status: 'ACTIVE',
          sortOrder: Number(data['sortOrder'] ?? 0),
          parentId: (data['parentId'] as string | null | undefined) ?? null,
          createdById: (data['createdById'] as string | null | undefined) ?? null,
        }

        rows.push(created)

        return { ...created }
      },
      async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
        const found = rows.find((candidate) => candidate.id === where.id)

        if (!found) throw new Error('record not found')

        Object.assign(found, data)

        return { ...found }
      },
    },
  }

  return prisma as unknown as PrismaService
}

describe('buildOrganizationTree', () => {
  it('按 sortOrder 构建完整的四级组织树', () => {
    const tree = buildOrganizationTree([
      CLASS_SE_2,
      MAJOR_SE,
      DEPARTMENT_ECON,
      SCHOOL,
      CLASS_SE_1,
      DEPARTMENT_CS,
    ])

    expect(tree).toHaveLength(1)
    expect(tree[0]?.code).toBe('SCHOOL')
    expect(tree[0]?.children.map((item) => item.code)).toEqual(['CS', 'ECON'])
    expect(tree[0]?.children[0]?.children[0]?.code).toBe('SE')
    expect(tree[0]?.children[0]?.children[0]?.children.map((item) => item.code)).toEqual([
      'SE-2401',
      'SE-2402',
    ])
  })

  it('停用节点及其整棵子树都不返回', () => {
    const tree = buildOrganizationTree([
      SCHOOL,
      { ...DEPARTMENT_CS, status: 'DISABLED' },
      MAJOR_SE,
      CLASS_SE_1,
      DEPARTMENT_ECON,
    ])

    expect(tree[0]?.children.map((item) => item.code)).toEqual(['ECON'])
  })

  it('includeDisabled 返回完整结构，供管理端修复', () => {
    const tree = buildOrganizationTree(
      [SCHOOL, { ...DEPARTMENT_CS, status: 'DISABLED' }, MAJOR_SE, CLASS_SE_1],
      true,
    )

    expect(tree[0]?.children).toHaveLength(1)
    expect(tree[0]?.children[0]?.status).toBe('DISABLED')
  })

  it('数据范围裁剪后缺失父节点时，子树仍作为根返回（不丢整棵子树）', () => {
    const tree = buildOrganizationTree([DEPARTMENT_CS, MAJOR_SE, CLASS_SE_1], false, true)

    expect(tree).toHaveLength(1)
    expect(tree[0]?.code).toBe('CS')
    expect(tree[0]?.children[0]?.code).toBe('SE')
    expect(tree[0]?.children[0]?.children.map((item) => item.code)).toEqual(['SE-2401'])
  })

  it('循环引用不会导致无限递归，相关节点被丢弃', () => {
    const tree = buildOrganizationTree([
      SCHOOL,
      { ...DEPARTMENT_CS, parentId: 'org-se' },
      { ...MAJOR_SE, parentId: DEPARTMENT_CS.id },
    ])

    expect(tree).toHaveLength(1)
    expect(tree[0]?.children).toEqual([])
  })
})

describe('OrganizationService', () => {
  let prisma: PrismaService
  let service: OrganizationService

  beforeEach(() => {
    prisma = createFakePrisma([SCHOOL, DEPARTMENT_CS, DEPARTMENT_ECON, MAJOR_SE, CLASS_SE_1])
    service = new OrganizationService(prisma)
  })

  it('在合法父节点下创建班级', async () => {
    const created = await service.create(
      { name: '软件工程二班', code: 'SE-2402', type: 'CLASS', parentId: MAJOR_SE.id },
      'actor-1',
    )

    expect(created.type).toBe('CLASS')
    expect(created.parentId).toBe(MAJOR_SE.id)
    expect(created.status).toBe('ACTIVE')
  })

  it('拒绝跨级挂载：班级直接挂在院系下', async () => {
    await expect(
      service.create(
        { name: '非法班级', code: 'SE-X', type: 'CLASS', parentId: DEPARTMENT_CS.id },
        'actor-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('拒绝把院系挂在专业下', async () => {
    await expect(
      service.create(
        { name: '非法院系', code: 'CS-X', type: 'DEPARTMENT', parentId: MAJOR_SE.id },
        'actor-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('拒绝在已停用的父节点下创建子节点', async () => {
    prisma = createFakePrisma([SCHOOL, { ...DEPARTMENT_CS, status: 'DISABLED' }, MAJOR_SE])
    service = new OrganizationService(prisma)

    await expect(
      service.create(
        { name: '新专业', code: 'CS-NEW', type: 'MAJOR', parentId: DEPARTMENT_CS.id },
        'actor-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException)
  })

  it('拒绝创建第二个学校根节点', async () => {
    await expect(
      service.create({ name: '另一所学校', code: 'SCHOOL-2', type: 'SCHOOL' }, 'actor-1'),
    ).rejects.toBeInstanceOf(ConflictException)
  })

  it('拒绝重复的组织编码', async () => {
    await expect(
      service.create(
        { name: '重复编码', code: 'CS', type: 'DEPARTMENT', parentId: SCHOOL.id },
        'actor-1',
      ),
    ).rejects.toBeInstanceOf(ConflictException)
  })

  it('拒绝把最后一个启用的学校停用', async () => {
    await expect(service.update(SCHOOL.id, { status: 'DISABLED' })).rejects.toBeInstanceOf(
      BadRequestException,
    )
  })

  it('父节点停用时不能启用子节点', async () => {
    prisma = createFakePrisma([
      SCHOOL,
      { ...DEPARTMENT_CS, status: 'DISABLED' },
      { ...MAJOR_SE, status: 'DISABLED' },
    ])
    service = new OrganizationService(prisma)

    await expect(service.update(MAJOR_SE.id, { status: 'ACTIVE' })).rejects.toBeInstanceOf(
      BadRequestException,
    )
  })

  it('不存在的节点更新时返回 404', async () => {
    await expect(service.update('org-missing', { name: 'x' })).rejects.toBeInstanceOf(
      NotFoundException,
    )
  })

  it('计算祖先链与后代范围', async () => {
    expect(await service.getAncestorIds(CLASS_SE_1.id)).toEqual([
      MAJOR_SE.id,
      DEPARTMENT_CS.id,
      SCHOOL.id,
    ])
    expect((await service.getSubtreeIds(DEPARTMENT_CS.id)).toSorted()).toEqual(
      [DEPARTMENT_CS.id, MAJOR_SE.id, CLASS_SE_1.id].toSorted(),
    )
    expect(await service.isWithinScope(CLASS_SE_1.id, DEPARTMENT_CS.id)).toBe(true)
    expect(await service.isWithinScope(DEPARTMENT_ECON.id, DEPARTMENT_CS.id)).toBe(false)
  })

  it('停用节点不能作为角色分配范围', async () => {
    prisma = createFakePrisma([SCHOOL, { ...DEPARTMENT_CS, status: 'DISABLED' }])
    service = new OrganizationService(prisma)

    await expect(service.assertActive(DEPARTMENT_CS.id)).rejects.toBeInstanceOf(BadRequestException)
  })

  it('子树计算排除停用节点及其下级', async () => {
    prisma = createFakePrisma([
      SCHOOL,
      DEPARTMENT_CS,
      MAJOR_SE,
      { ...CLASS_SE_1, status: 'DISABLED' },
    ])
    service = new OrganizationService(prisma)

    const ids = await service.getSubtreeIds(DEPARTMENT_CS.id)

    expect(ids).toContain(MAJOR_SE.id)
    expect(ids).not.toContain(CLASS_SE_1.id)
  })

  it('授权根节点停用时子树为空（失败关闭）', async () => {
    prisma = createFakePrisma([SCHOOL, { ...DEPARTMENT_CS, status: 'DISABLED' }, MAJOR_SE])
    service = new OrganizationService(prisma)

    expect(await service.getSubtreeIds(DEPARTMENT_CS.id)).toEqual([])
    expect(await service.isPathActive(MAJOR_SE.id)).toBe(false)
  })

  it('任意祖先停用时下级授权范围为空', async () => {
    prisma = createFakePrisma([
      { ...SCHOOL, status: 'DISABLED' },
      DEPARTMENT_CS,
      MAJOR_SE,
      CLASS_SE_1,
    ])
    service = new OrganizationService(prisma)

    expect(await service.getSubtreeIds(DEPARTMENT_CS.id)).toEqual([])
    expect(await service.getSubtreeIds(CLASS_SE_1.id)).toEqual([])
    expect(await service.isPathActive(SCHOOL.id)).toBe(false)
  })

  it('管理范围包含停用节点本身，但不穿透到其后代', async () => {
    prisma = createFakePrisma([
      SCHOOL,
      { ...DEPARTMENT_CS, status: 'DISABLED' },
      MAJOR_SE,
      CLASS_SE_1,
    ])
    service = new OrganizationService(prisma)

    const manageable = await service.getManageableSubtreeIds(SCHOOL.id)

    expect(manageable).toContain(DEPARTMENT_CS.id)
    expect(manageable).not.toContain(MAJOR_SE.id)
    expect(manageable).not.toContain(CLASS_SE_1.id)
    // 读取范围则连停用节点本身都不包含
    expect(await service.getSubtreeIds(SCHOOL.id)).not.toContain(DEPARTMENT_CS.id)
  })

  it('恢复 ACTIVE 后同一分配自动恢复授权范围（不修改分配数据）', async () => {
    prisma = createFakePrisma([
      SCHOOL,
      DEPARTMENT_CS,
      MAJOR_SE,
      { ...CLASS_SE_1, status: 'DISABLED' },
    ])
    service = new OrganizationService(prisma)

    expect(await service.getSubtreeIds(DEPARTMENT_CS.id)).not.toContain(CLASS_SE_1.id)

    await service.update(CLASS_SE_1.id, { status: 'ACTIVE' })

    expect(await service.getSubtreeIds(DEPARTMENT_CS.id)).toContain(CLASS_SE_1.id)
  })
})
