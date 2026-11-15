import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getOrganizationTree, updateOrganization } from '../organizations.api'
import { assignRole, revokeRoleAssignment } from '../role-assignments.api'
import { listStudents } from '../students.api'
import { listUsers, updateMyProfile } from '../users.api'

const apiRequest = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-client', () => ({ apiRequest }))

describe('rbac api', () => {
  beforeEach(() => {
    apiRequest.mockReset()
    apiRequest.mockResolvedValue({ total: 0, list: [] })
  })

  it('用户列表只传有值的筛选条件', async () => {
    await listUsers({ page: 2, pageSize: 20, keyword: '张三', status: undefined })

    expect(apiRequest).toHaveBeenCalledWith('/users', {
      method: 'GET',
      query: { page: 2, pageSize: 20, keyword: '张三' },
    })
  })

  it('学生列表把 unassignedOnly 作为布尔查询参数', async () => {
    await listStudents({ page: 1, pageSize: 10, unassignedOnly: true })

    expect(apiRequest).toHaveBeenCalledWith('/student-profiles', {
      method: 'GET',
      query: { page: 1, pageSize: 10, unassignedOnly: true },
    })
  })

  it('修改本人资料使用 PATCH /users/me/profile', async () => {
    await updateMyProfile({ realName: '张三', phone: null })

    expect(apiRequest).toHaveBeenCalledWith('/users/me/profile', {
      method: 'PATCH',
      body: { realName: '张三', phone: null },
    })
  })

  it('组织树默认包含停用节点', async () => {
    await getOrganizationTree(true)

    expect(apiRequest).toHaveBeenCalledWith('/organizations/tree', {
      method: 'GET',
      query: { includeDisabled: 'true' },
    })
  })

  it('修改组织节点使用 PATCH', async () => {
    await updateOrganization('org-1', { name: '计算机学院', sortOrder: 2 })

    expect(apiRequest).toHaveBeenCalledWith('/organizations/org-1', {
      method: 'PATCH',
      body: { name: '计算机学院', sortOrder: 2 },
    })
  })

  it('分配与撤销角色使用对应方法与路径', async () => {
    await assignRole({ userId: 'user-1', roleCode: 'CLASS_COORDINATOR', scopeOrgUnitId: 'class-1' })
    await revokeRoleAssignment('assignment-1')

    expect(apiRequest).toHaveBeenCalledWith('/role-assignments', {
      method: 'POST',
      body: { userId: 'user-1', roleCode: 'CLASS_COORDINATOR', scopeOrgUnitId: 'class-1' },
    })
    expect(apiRequest).toHaveBeenCalledWith('/role-assignments/assignment-1', { method: 'DELETE' })
  })
})
