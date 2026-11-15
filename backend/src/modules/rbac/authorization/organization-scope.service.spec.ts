import { ForbiddenException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'

import type { OrganizationService } from '../organizations/organization.service.js'
import { OrganizationScopeService } from './organization-scope.service.js'
import type { EffectiveRoleAssignment, PermissionService } from './permission.service.js'

type Scope = EffectiveRoleAssignment['dataScope']

const SUBTREES: Record<string, string[]> = {
  'org-school': ['org-school', 'org-cs', 'org-econ', 'org-se', 'org-se-1', 'org-se-2'],
  'org-cs': ['org-cs', 'org-se', 'org-se-1', 'org-se-2'],
  'org-econ': ['org-econ', 'org-accounting'],
  'org-se': ['org-se', 'org-se-1', 'org-se-2'],
  'org-se-1': ['org-se-1'],
  'org-se-2': ['org-se-2'],
  'org-accounting': ['org-accounting'],
}

function scopeService(
  grants: Array<{ dataScope: Scope; scopeOrgUnitId: string | null }>,
  overrides: Record<string, string[]> = {},
  manageOverrides: Record<string, string[]> = {},
) {
  const assignments: EffectiveRoleAssignment[] = grants.map((grant, index) => ({
    assignmentId: `assignment-${index}`,
    roleId: `role-${index}`,
    roleCode: 'TEST_ROLE',
    roleName: '测试角色',
    dataScope: grant.dataScope,
    scopeOrgUnitId: grant.scopeOrgUnitId,
    validFrom: new Date('2026-01-01T00:00:00.000Z'),
    validUntil: null,
  }))

  const permissionService = {
    findPermissionAssignments: async () => assignments,
  } as unknown as PermissionService

  const organizationService = {
    // overrides 用于模拟「授权根节点或祖先已停用 → 子树为空」
    getSubtreeIds: async (id: string) => overrides[id] ?? SUBTREES[id] ?? [id],
    getManageableSubtreeIds: async (id: string) =>
      manageOverrides[id] ?? overrides[id] ?? SUBTREES[id] ?? [id],
  } as unknown as OrganizationService

  return new OrganizationScopeService(permissionService, organizationService)
}

describe('OrganizationScopeService.resolve', () => {
  it('没有任何授予该权限的分配时返回 NONE', async () => {
    expect(await scopeService([]).resolve('user-1', 'organization:unit:read')).toEqual({
      kind: 'NONE',
    })
  })

  it('院系管理员得到本院系子树，不包含其他院系', async () => {
    const scope = await scopeService([
      { dataScope: 'DEPARTMENT', scopeOrgUnitId: 'org-cs' },
    ]).resolve('user-1', 'organization:unit:read')

    expect(scope.kind).toBe('SUBTREE')

    if (scope.kind !== 'SUBTREE') throw new Error('unreachable')

    expect(scope.orgUnitIds).toContain('org-se-1')
    expect(scope.orgUnitIds).not.toContain('org-econ')
    expect(scope.orgUnitIds).not.toContain('org-accounting')
  })

  it('多个班级协管分配取并集，且不扩大到其他班级', async () => {
    const scope = await scopeService([
      { dataScope: 'CLASS', scopeOrgUnitId: 'org-se-1' },
      { dataScope: 'CLASS', scopeOrgUnitId: 'org-se-2' },
    ]).resolve('user-1', 'graduation:progress:read')

    expect(scope).toEqual({
      kind: 'SUBTREE',
      orgUnitIds: ['org-se-1', 'org-se-2'],
    })
  })

  it('GLOBAL 返回 ALL', async () => {
    const scope = await scopeService([{ dataScope: 'GLOBAL', scopeOrgUnitId: null }]).resolve(
      'user-1',
      'organization:unit:read',
    )

    expect(scope).toEqual({ kind: 'ALL' })
  })

  it('ASSIGNED / SELF 不产生组织范围，避免被当成全量访问', async () => {
    const scope = await scopeService([
      { dataScope: 'ASSIGNED', scopeOrgUnitId: null },
      { dataScope: 'SELF', scopeOrgUnitId: null },
    ]).resolve('user-1', 'organization:unit:read')

    expect(scope).toEqual({ kind: 'NONE' })
  })

  it('缺少 scopeOrgUnitId 的分配不会退化成全局范围', async () => {
    const scope = await scopeService([{ dataScope: 'DEPARTMENT', scopeOrgUnitId: null }]).resolve(
      'user-1',
      'organization:unit:read',
    )

    expect(scope).toEqual({ kind: 'NONE' })
  })

  it('授权根节点停用后该分配不再产生范围（失败关闭）', async () => {
    const scope = await scopeService([{ dataScope: 'DEPARTMENT', scopeOrgUnitId: 'org-cs' }], {
      'org-cs': [],
    }).resolve('user-1', 'organization:unit:read')

    expect(scope).toEqual({ kind: 'NONE' })
  })

  it('多个班级中只有一个停用时，仅保留仍然有效的那部分范围', async () => {
    const scope = await scopeService(
      [
        { dataScope: 'CLASS', scopeOrgUnitId: 'org-se-1' },
        { dataScope: 'CLASS', scopeOrgUnitId: 'org-se-2' },
      ],
      { 'org-se-1': [] },
    ).resolve('user-1', 'graduation:progress:read')

    expect(scope).toEqual({ kind: 'SUBTREE', orgUnitIds: ['org-se-2'] })
  })

  it('修改操作可以看到停用后代，但读取范围仍只包含 ACTIVE 节点', async () => {
    const service = scopeService(
      [{ dataScope: 'DEPARTMENT', scopeOrgUnitId: 'org-cs' }],
      {},
      { 'org-cs': ['org-cs', 'org-se', 'org-se-1', 'org-se-disabled'] },
    )

    const read = await service.resolve('user-1', 'organization:unit:read')

    expect(read.kind).toBe('SUBTREE')

    if (read.kind !== 'SUBTREE') throw new Error('unreachable')

    expect(read.orgUnitIds).not.toContain('org-se-disabled')

    const manage = await service.resolve('user-1', 'organization:unit:update', {
      includeDisabledDescendants: true,
    })

    expect(manage.kind).toBe('SUBTREE')

    if (manage.kind !== 'SUBTREE') throw new Error('unreachable')

    expect(manage.orgUnitIds).toContain('org-se-disabled')
  })

  it('停用范围的记录即使存在，也无法通过单节点校验', async () => {
    const service = scopeService([{ dataScope: 'DEPARTMENT', scopeOrgUnitId: 'org-cs' }], {
      'org-cs': [],
    })

    await expect(
      service.assertOrgUnitAccess('user-1', 'organization:unit:read', 'org-se-1'),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })
})

describe('OrganizationScopeService.buildOrgUnitFilter', () => {
  it('ALL 不加过滤条件', async () => {
    const service = scopeService([{ dataScope: 'GLOBAL', scopeOrgUnitId: null }])

    expect(await service.buildOrgUnitFilter('user-1', 'organization:unit:read')).toBeUndefined()
  })

  it('子树范围生成 id in 条件，真正下推到数据库', async () => {
    const service = scopeService([{ dataScope: 'MAJOR', scopeOrgUnitId: 'org-se' }])
    const filter = await service.buildOrgUnitFilter('user-1', 'organization:unit:read')

    expect(filter).toEqual({ id: { in: ['org-se', 'org-se-1', 'org-se-2'] } })
  })

  it('无范围时失败关闭，抛 403 而不是返回全量', async () => {
    const service = scopeService([])

    await expect(
      service.buildOrgUnitFilter('user-1', 'organization:unit:read'),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })
})

describe('OrganizationScopeService.assertOrgUnitAccess', () => {
  it('允许访问范围内节点', async () => {
    const service = scopeService([{ dataScope: 'DEPARTMENT', scopeOrgUnitId: 'org-cs' }])

    await expect(
      service.assertOrgUnitAccess('user-1', 'organization:unit:update', 'org-se-1'),
    ).resolves.toBeUndefined()
  })

  it('拒绝访问其他院系的节点', async () => {
    const service = scopeService([{ dataScope: 'DEPARTMENT', scopeOrgUnitId: 'org-cs' }])

    await expect(
      service.assertOrgUnitAccess('user-1', 'organization:unit:update', 'org-accounting'),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('拒绝访问同一院系外的其他班级', async () => {
    const service = scopeService([{ dataScope: 'CLASS', scopeOrgUnitId: 'org-se-1' }])

    await expect(
      service.assertOrgUnitAccess('user-1', 'graduation:progress:read', 'org-se-2'),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })
})
