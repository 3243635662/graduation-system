import {
  API_PREFIX,
  DEFAULT_MENU_TREE,
  PRESET_ROLES,
  ROLE_MENU_CODES,
  ROLE_PERMISSION_CODES,
  type MenuTreeNode,
} from '@graduation/shared'
import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import type { App } from 'supertest/types.js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { configureGlobalEnhancers } from '../src/common/configure-global-enhancers.js'
import { REDIS_CLIENT } from '../src/common/redis/redis.constants.js'
import { RedisService } from '../src/common/redis/redis.service.js'
import { AccessTokenGuard } from '../src/modules/auth/guards/access-token.guard.js'
import { TokenService } from '../src/modules/auth/services/token.service.js'
import { MenuCacheInvalidatorService } from '../src/modules/menus/menu-cache-invalidator.service.js'
import { MENU_CACHE_CONFIG, loadMenuCacheConfig } from '../src/modules/menus/menu-cache.config.js'
import { MenuCacheService } from '../src/modules/menus/menu-cache.service.js'
import { MenusController } from '../src/modules/menus/menus.controller.js'
import { MenusService } from '../src/modules/menus/menus.service.js'
import { CoordinatorEligibilityService } from '../src/modules/profiles/coordinator-eligibility.service.js'
import { RoleAssignmentsController } from '../src/modules/rbac/assignments/role-assignments.controller.js'
import { RoleAssignmentsService } from '../src/modules/rbac/assignments/role-assignments.service.js'
import { OrganizationScopeService } from '../src/modules/rbac/authorization/organization-scope.service.js'
import { PermissionService } from '../src/modules/rbac/authorization/permission.service.js'
import { PermissionsGuard } from '../src/modules/rbac/authorization/permissions.guard.js'
import { OrganizationController } from '../src/modules/rbac/organizations/organization.controller.js'
import { OrganizationService } from '../src/modules/rbac/organizations/organization.service.js'
import { RolesController } from '../src/modules/rbac/roles/roles.controller.js'
import { RolesService } from '../src/modules/rbac/roles/roles.service.js'
import { UsersController } from '../src/modules/users/users.controller.js'
import { UsersService } from '../src/modules/users/users.service.js'
import { PrismaService } from '../src/prisma/prisma.service.js'

const KEY_PREFIX = 'test:e2e:rbac'

type OrgType = 'SCHOOL' | 'DEPARTMENT' | 'MAJOR' | 'CLASS'
type DataScopeValue = 'GLOBAL' | 'SCHOOL' | 'DEPARTMENT' | 'MAJOR' | 'CLASS' | 'ASSIGNED' | 'SELF'

interface OrgRow {
  id: string
  name: string
  code: string
  type: OrgType
  status: 'ACTIVE' | 'DISABLED'
  sortOrder: number
  parentId: string | null
  createdAt: Date
}

interface RoleRow {
  id: string
  code: string
  name: string
  description: string
  dataScope: DataScopeValue
  isSystem: boolean
  status: 'ACTIVE' | 'DISABLED'
  createdAt: Date
  updatedAt: Date
}

/**
 * 当前授权行：user_roles 只保存「此刻有效」的授权，撤销即删除行，
 * 因此这里没有 revokedAt / revocationReason 字段。
 */
interface AssignmentRow {
  id: string
  userId: string
  roleId: string
  scopeOrgUnitId: string | null
  scopeKey: string
  assignedById: string | null
  validFrom: Date
  validUntil: Date | null
  createdAt: Date
}

const NOW = new Date('2026-01-01T00:00:00.000Z')

const ORGS: OrgRow[] = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    name: '示范大学',
    code: 'SCHOOL',
    type: 'SCHOOL',
    status: 'ACTIVE',
    sortOrder: 0,
    parentId: null,
    createdAt: NOW,
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    name: '计算机学院',
    code: 'CS',
    type: 'DEPARTMENT',
    status: 'ACTIVE',
    sortOrder: 1,
    parentId: '00000000-0000-4000-8000-000000000001',
    createdAt: NOW,
  },
  {
    id: '00000000-0000-4000-8000-000000000003',
    name: '经济管理学院',
    code: 'ECON',
    type: 'DEPARTMENT',
    status: 'ACTIVE',
    sortOrder: 2,
    parentId: '00000000-0000-4000-8000-000000000001',
    createdAt: NOW,
  },
  {
    id: '00000000-0000-4000-8000-000000000004',
    name: '软件工程',
    code: 'SE',
    type: 'MAJOR',
    status: 'ACTIVE',
    sortOrder: 1,
    parentId: '00000000-0000-4000-8000-000000000002',
    createdAt: NOW,
  },
  {
    id: '00000000-0000-4000-8000-000000000005',
    name: '软件工程一班',
    code: 'SE-1',
    type: 'CLASS',
    status: 'ACTIVE',
    sortOrder: 1,
    parentId: '00000000-0000-4000-8000-000000000004',
    createdAt: NOW,
  },
  {
    id: '00000000-0000-4000-8000-000000000006',
    name: '会计一班',
    code: 'ACC-1',
    type: 'CLASS',
    status: 'ACTIVE',
    sortOrder: 1,
    parentId: '00000000-0000-4000-8000-000000000003',
    createdAt: NOW,
  },
]

const ROLES: RoleRow[] = PRESET_ROLES.map((role, index) => ({
  id: `role-${role.code}`,
  code: role.code,
  name: role.name,
  description: role.description,
  dataScope: role.dataScope,
  isSystem: true,
  status: 'ACTIVE',
  createdAt: new Date(NOW.getTime() + index),
  updatedAt: NOW,
}))

const USERS = [
  {
    id: '10000000-0000-4000-8000-000000000001',
    email: 'school@example.com',
    realName: '校管理员',
    status: 'ACTIVE' as const,
    deletedAt: null,
  },
  {
    id: '10000000-0000-4000-8000-000000000002',
    email: 'dept@example.com',
    realName: '院系管理员',
    status: 'ACTIVE' as const,
    deletedAt: null,
  },
  {
    id: '10000000-0000-4000-8000-000000000003',
    email: 'major@example.com',
    realName: '专业管理员',
    status: 'ACTIVE' as const,
    deletedAt: null,
  },
  {
    id: '10000000-0000-4000-8000-000000000004',
    email: 'student@example.com',
    realName: '学生',
    status: 'ACTIVE' as const,
    deletedAt: null,
  },
  {
    id: '10000000-0000-4000-8000-000000000005',
    email: 'outside@example.com',
    realName: '外院学生',
    status: 'ACTIVE' as const,
    deletedAt: null,
  },
]

let sequence = 0

/** 范围键规范化：组织角色取组织节点 ID，其余统一 GLOBAL */
function assignmentRow(
  id: string,
  userId: string,
  roleId: string,
  scopeOrgUnitId: string | null,
): AssignmentRow {
  return {
    id,
    userId,
    roleId,
    scopeOrgUnitId,
    scopeKey: scopeOrgUnitId ?? 'GLOBAL',
    assignedById: null,
    validFrom: NOW,
    validUntil: null,
    createdAt: NOW,
  }
}

const ASSIGNMENTS: AssignmentRow[] = [
  assignmentRow(
    '20000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001',
    'role-SCHOOL_ADMIN',
    '00000000-0000-4000-8000-000000000001',
  ),
  assignmentRow(
    '20000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000002',
    'role-DEPARTMENT_ADMIN',
    '00000000-0000-4000-8000-000000000002',
  ),
  assignmentRow(
    '20000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000003',
    'role-MAJOR_ADMIN',
    '00000000-0000-4000-8000-000000000004',
  ),
  assignmentRow(
    '20000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000004',
    'role-STUDENT',
    null,
  ),
  assignmentRow(
    '20000000-0000-4000-8000-000000000005',
    '10000000-0000-4000-8000-000000000005',
    'role-STUDENT',
    null,
  ),
]

/** 撤销历史：只追加，用于验证「删除当前行前先写快照」 */
const HISTORY: Array<Record<string, unknown>> = []

/** 菜单行：id 直接使用 code，便于断言 */
function flattenMenus(
  nodes: MenuTreeNode[],
  parentId: string | null,
  out: Array<Record<string, unknown>>,
) {
  for (const node of nodes) {
    out.push({
      id: node.code,
      code: node.code,
      title: node.title,
      path: node.path,
      componentKey: node.componentKey ?? null,
      icon: node.icon ?? null,
      type: node.type,
      parentId,
      sortOrder: node.sortOrder,
      visible: node.visible ?? true,
      status: 'ACTIVE',
    })

    if (node.children?.length) flattenMenus(node.children, node.code, out)
  }
}

const MENUS: Array<Record<string, unknown>> = []
flattenMenus(DEFAULT_MENU_TREE, null, MENUS)

const ROLE_MENUS = PRESET_ROLES.flatMap((role) =>
  ROLE_MENU_CODES[role.code].map((menuCode) => ({ roleId: `role-${role.code}`, menuId: menuCode })),
)

const ROLE_PERMISSIONS = PRESET_ROLES.flatMap((role) =>
  ROLE_PERMISSION_CODES[role.code].map((permissionCode) => ({
    roleId: `role-${role.code}`,
    code: permissionCode,
  })),
)

function roleById(roleId: string): RoleRow | undefined {
  return ROLES.find((role) => role.id === roleId)
}

function decorateAssignment(row: AssignmentRow) {
  const role = roleById(row.roleId)
  const org = row.scopeOrgUnitId ? ORGS.find((item) => item.id === row.scopeOrgUnitId) : null

  return {
    ...row,
    role: {
      id: role?.id,
      code: role?.code ?? 'UNKNOWN',
      name: role?.name ?? '未知',
      dataScope: role?.dataScope ?? 'SELF',
      status: role?.status ?? 'DISABLED',
    },
    scopeOrgUnit: org ? { name: org.name, type: org.type } : null,
  }
}

function matchesAssignment(
  row: AssignmentRow,
  where: Record<string, unknown>,
  now = new Date(),
): boolean {
  if (typeof where['userId'] === 'string' && row.userId !== where['userId']) return false

  // 当前授权表只保存有效授权：撤销即删除行，无需再判断 revokedAt
  if (typeof where['roleId'] === 'string' && row.roleId !== where['roleId']) return false

  if ('scopeOrgUnitId' in where) {
    const expected = where['scopeOrgUnitId']

    if ((row.scopeOrgUnitId ?? null) !== (expected ?? null)) return false
  }

  const validFrom = where['validFrom'] as { lte: Date } | undefined

  if (validFrom && row.validFrom.getTime() > validFrom.lte.getTime()) return false

  const or = where['OR'] as Array<{ validUntil: null } | { validUntil: { gt: Date } }> | undefined

  if (or) {
    const ok = or.some((condition) => {
      if ('validUntil' in condition && condition.validUntil === null) return row.validUntil === null

      return (
        row.validUntil !== null &&
        row.validUntil.getTime() >
          (condition as { validUntil: { gt: Date } }).validUntil.gt.getTime()
      )
    })

    if (!ok) return false
  }

  const roleFilter = where['role'] as { status?: string } | undefined

  if (roleFilter?.status) {
    const role = roleById(row.roleId)

    if (role?.status !== roleFilter.status) return false
  }

  // 隐式：查询有效分配时通常带 validFrom/OR；这里不额外过滤，保持可预测
  void now

  return true
}

function createPrismaFake() {
  const prisma = {
    authSession: {
      async findUnique({ where }: { where: { id: string } }) {
        const user = USERS.find((item) => `session-${item.id}` === where.id)

        if (!user) return null

        return {
          id: where.id,
          revokedAt: null,
          expiresAt: new Date(Date.now() + 3_600_000),
          user: { id: user.id, status: user.status },
        }
      },
    },
    user: {
      async findUnique({ where }: { where: { id?: string; email?: string } }) {
        return (
          USERS.find((item) => (where.id ? item.id === where.id : item.email === where.email)) ??
          null
        )
      },
    },
    role: {
      async findMany() {
        return [...ROLES].toSorted((a, b) => (a.code < b.code ? -1 : 1))
      },
      async findUnique({ where }: { where: { id?: string; code?: string } }) {
        return (
          ROLES.find((item) => (where.id ? item.id === where.id : item.code === where.code)) ?? null
        )
      },
    },
    rolePermission: {
      async findMany({
        where,
      }: {
        where: { roleId: { in: string[] }; permission?: { code: string } }
      }) {
        return ROLE_PERMISSIONS.filter(
          (grant) =>
            where.roleId.in.includes(grant.roleId) &&
            (!where.permission || grant.code === where.permission.code),
        ).map((grant) => ({ roleId: grant.roleId, permission: { code: grant.code } }))
      },
    },
    roleMenu: {
      async findMany({ where }: { where: { roleId: { in: string[] } } }) {
        return ROLE_MENUS.filter((item) => where.roleId.in.includes(item.roleId)).map((item) => ({
          menuId: item.menuId,
        }))
      },
    },
    menu: {
      async findMany({ where }: { where?: { id?: { in: string[] } } }) {
        if (!where?.id) return [...MENUS]

        return MENUS.filter((item) => where.id!.in.includes(String(item['id'])))
      },
    },
    userRole: {
      async findMany({
        where,
      }: {
        where: Record<string, unknown>
        select?: unknown
        orderBy?: unknown
      }) {
        return ASSIGNMENTS.filter((row) => matchesAssignment(row, where))
          .toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .map(decorateAssignment)
      },
      async findFirst({ where }: { where: Record<string, unknown> }) {
        const row = ASSIGNMENTS.find((item) => matchesAssignment(item, where))

        return row ? { id: row.id, roleId: row.roleId } : null
      },
      async findUnique({ where }: { where: { id: string } }) {
        const row = ASSIGNMENTS.find((item) => item.id === where.id)

        return row ? decorateAssignment(row) : null
      },
      async create({ data }: { data: Record<string, unknown> }) {
        const scopeOrgUnitId = (data['scopeOrgUnitId'] as string | null | undefined) ?? null
        const scopeKey = String(data['scopeKey'])

        // 唯一键 uk_user_role_scope(userId, roleId, scopeKey)：重复分配必须由数据库兜底
        const duplicated = ASSIGNMENTS.some(
          (item) =>
            item.userId === String(data['userId']) &&
            item.roleId === String(data['roleId']) &&
            item.scopeKey === scopeKey,
        )

        if (duplicated) {
          throw Object.assign(new Error('unique'), { code: 'P2002' })
        }

        const row: AssignmentRow = {
          id: `30000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
          userId: String(data['userId']),
          roleId: String(data['roleId']),
          scopeOrgUnitId,
          scopeKey,
          assignedById: (data['assignedById'] as string | null | undefined) ?? null,
          validFrom: data['validFrom'] as Date,
          validUntil: (data['validUntil'] as Date | null | undefined) ?? null,
          createdAt: new Date(),
        }

        ASSIGNMENTS.push(row)

        return decorateAssignment(row)
      },
      async deleteMany({ where }: { where: { id: string } }) {
        const index = ASSIGNMENTS.findIndex((item) => item.id === where.id)

        if (index < 0) return { count: 0 }

        ASSIGNMENTS.splice(index, 1)

        return { count: 1 }
      },
      async count({ where }: { where: { userId: string } }) {
        return ASSIGNMENTS.filter((item) => item.userId === where.userId).length
      },
    },
    // 撤销 = 先写不可变历史快照，再删除当前授权行
    userRoleHistory: {
      async create({ data }: { data: Record<string, unknown> }) {
        HISTORY.push(data)

        return { id: `history-${HISTORY.length}`, ...data }
      },
    },
    organizationUnit: {
      async findMany({ where }: { where?: Record<string, unknown> }) {
        if (!where) return [...ORGS]

        const idFilter = where['id'] as { in: string[] } | undefined
        const parentFilter = where['parentId'] as { in: string[] } | undefined
        const statusFilter = where['status'] as string | undefined

        return ORGS.filter((org) => {
          if (idFilter && !idFilter.in.includes(org.id)) return false
          if (statusFilter && org.status !== statusFilter) return false
          if (parentFilter && (!org.parentId || !parentFilter.in.includes(org.parentId))) {
            return false
          }

          return true
        })
      },
      async findUnique({ where }: { where: { id: string } }) {
        return ORGS.find((org) => org.id === where.id) ?? null
      },
      async findFirst({ where }: { where: { type?: string } }) {
        return ORGS.find((org) => (where.type ? org.type === where.type : true)) ?? null
      },
      async count() {
        return ORGS.length
      },
      async create({ data }: { data: Record<string, unknown> }) {
        const row: OrgRow = {
          id: `org-created-${++sequence}`,
          name: String(data['name']),
          code: String(data['code']),
          type: data['type'] as OrgType,
          status: 'ACTIVE',
          sortOrder: Number(data['sortOrder'] ?? 0),
          parentId: (data['parentId'] as string | null | undefined) ?? null,
          createdAt: new Date(),
        }

        ORGS.push(row)

        return row
      },
      async update({ where, data }: { where: { id: string }; data: Record<string, unknown> }) {
        const row = ORGS.find((org) => org.id === where.id)!

        Object.assign(row, data)

        return row
      },
    },
    $transaction: async (callback: (tx: unknown) => unknown) => callback(prisma),
  }

  return prisma
}

function createRedisFake() {
  const store = new Map<string, string>()

  return {
    store,
    client: {
      isReady: true,
      async get(key: string) {
        return store.get(key) ?? null
      },
      async set(key: string, value: string, options?: { EX?: number; NX?: boolean }) {
        if (options?.NX && store.has(key)) return null

        store.set(key, value)

        return 'OK'
      },
      async del(key: string) {
        return store.delete(key) ? 1 : 0
      },
      async incr(key: string) {
        const next = Number(store.get(key) ?? '0') + 1
        store.set(key, String(next))

        return next
      },
    },
  }
}

describe('RBAC 授权与数据范围 (e2e)', () => {
  let app: INestApplication<App>
  let tokenService: TokenService
  let redisFake: ReturnType<typeof createRedisFake>

  const api = `/${API_PREFIX}`
  const tokenOf = (userId: string) => tokenService.signAccessToken(userId, `session-${userId}`)

  beforeAll(async () => {
    process.env['JWT_ACCESS_SECRET'] = 'rbac-e2e-secret'
    process.env['ACCESS_TOKEN_TTL_SECONDS'] = '900'
    process.env['MENU_CACHE_KEY_PREFIX'] = KEY_PREFIX

    const prismaFake = createPrismaFake()
    redisFake = createRedisFake()

    const moduleFixture = await Test.createTestingModule({
      controllers: [
        RolesController,
        OrganizationController,
        RoleAssignmentsController,
        MenusController,
        UsersController,
      ],
      providers: [
        { provide: PrismaService, useValue: prismaFake },
        { provide: REDIS_CLIENT, useValue: redisFake.client },
        RedisService,
        TokenService,
        AccessTokenGuard,
        PermissionService,
        OrganizationService,
        OrganizationScopeService,
        {
          provide: CoordinatorEligibilityService,
          useValue: {
            assertEligible: async () => undefined,
            filterAssignments: async (_userId: string, assignments: unknown[]) => ({
              assignments,
              nextExpiry: null,
            }),
          },
        },
        PermissionsGuard,
        RoleAssignmentsService,
        UsersService,
        MenuCacheService,
        MenuCacheInvalidatorService,
        MenusService,
        RolesService,
        { provide: MENU_CACHE_CONFIG, useValue: loadMenuCacheConfig() },
      ],
    }).compile()

    app = moduleFixture.createNestApplication()
    app.setGlobalPrefix(API_PREFIX)
    configureGlobalEnhancers(app)
    await app.init()

    tokenService = moduleFixture.get(TokenService)
  })

  afterAll(async () => {
    await app.close()
  })

  const auth = (userId: string) => ({ Authorization: `Bearer ${tokenOf(userId)}` })

  describe('菜单入口与角色接口', () => {
    it('未登录访问角色接口返回 401', async () => {
      await request(app.getHttpServer()).get(`${api}/roles`).expect(401)
    })

    it('学生直接调用角色接口返回 403（菜单隐藏不是安全措施）', async () => {
      const response = await request(app.getHttpServer())
        .get(`${api}/roles`)
        .set(auth('10000000-0000-4000-8000-000000000004'))
        .expect(403)

      expect(response.body.code).toBe(40300)
    })

    it('学校管理员可以读取角色模板', async () => {
      const response = await request(app.getHttpServer())
        .get(`${api}/roles`)
        .set(auth('10000000-0000-4000-8000-000000000001'))
        .expect(200)

      expect(response.body.data).toHaveLength(PRESET_ROLES.length)
    })

    it('学生不能读取组织树', async () => {
      await request(app.getHttpServer())
        .get(`${api}/organizations/tree`)
        .set(auth('10000000-0000-4000-8000-000000000004'))
        .expect(403)
    })
  })

  describe('组织数据范围', () => {
    it('学校管理员看到全校组织', async () => {
      const response = await request(app.getHttpServer())
        .get(`${api}/organizations/tree`)
        .set(auth('10000000-0000-4000-8000-000000000001'))
        .expect(200)

      const root = response.body.data[0]

      expect(root.code).toBe('SCHOOL')
      expect(root.children.map((node: { code: string }) => node.code)).toEqual(['CS', 'ECON'])
    })

    it('院系管理员只看到本院系子树', async () => {
      const response = await request(app.getHttpServer())
        .get(`${api}/organizations/tree`)
        .set(auth('10000000-0000-4000-8000-000000000002'))
        .expect(200)

      expect(response.body.data).toHaveLength(1)
      expect(response.body.data[0].code).toBe('CS')
      expect(response.body.data[0].children[0].code).toBe('SE')
    })

    it('院系管理员访问其他院系节点返回 403', async () => {
      await request(app.getHttpServer())
        .get(`${api}/organizations/00000000-0000-4000-8000-000000000003`)
        .set(auth('10000000-0000-4000-8000-000000000002'))
        .expect(403)
    })

    it('院系管理员访问本院系班级节点成功', async () => {
      const response = await request(app.getHttpServer())
        .get(`${api}/organizations/00000000-0000-4000-8000-000000000005`)
        .set(auth('10000000-0000-4000-8000-000000000002'))
        .expect(200)

      expect(response.body.data.code).toBe('SE-1')
    })
  })

  describe('组织停用后的授权收缩（失败关闭）', () => {
    const patchStatus = (id: string, status: 'ACTIVE' | 'DISABLED') =>
      request(app.getHttpServer())
        .patch(`${api}/organizations/${id}`)
        .set(auth('10000000-0000-4000-8000-000000000001'))
        .send({ status })

    it('院系停用后：院系管理员失去该范围，学校管理员仍可看到其他院系', async () => {
      const versionKey = `${KEY_PREFIX}:version`
      const versionBefore = Number(redisFake.store.get(versionKey) ?? '0')

      await patchStatus('00000000-0000-4000-8000-000000000002', 'DISABLED').expect(200)

      // 状态变化必须触发菜单缓存失效
      expect(Number(redisFake.store.get(versionKey))).toBeGreaterThan(versionBefore)

      await request(app.getHttpServer())
        .get(`${api}/organizations/tree`)
        .set(auth('10000000-0000-4000-8000-000000000002'))
        .expect(403)

      const schoolTree = await request(app.getHttpServer())
        .get(`${api}/organizations/tree`)
        .set(auth('10000000-0000-4000-8000-000000000001'))
        .expect(200)

      expect(schoolTree.body.data[0].children.map((node: { code: string }) => node.code)).toEqual([
        'ECON',
      ])

      // 停用期间也不能在已停用范围内创建授权
      await request(app.getHttpServer())
        .post(`${api}/role-assignments`)
        .set(auth('10000000-0000-4000-8000-000000000002'))
        .send({
          userId: '10000000-0000-4000-8000-000000000004',
          roleCode: 'CLASS_COORDINATOR',
          scopeOrgUnitId: '00000000-0000-4000-8000-000000000005',
        })
        .expect(403)
    })

    it('院系停用后：院系管理员菜单立即清空', async () => {
      const menus = await request(app.getHttpServer())
        .get(`${api}/menus/current`)
        .set(auth('10000000-0000-4000-8000-000000000002'))
        .expect(200)

      expect(menus.body.data).toEqual([])
    })

    it('停用祖先下不能直接修改其他后代，但停用节点本身可以恢复', async () => {
      // CS 已停用：其子节点 SE 不应出现在管理范围里
      await request(app.getHttpServer())
        .patch(`${api}/organizations/00000000-0000-4000-8000-000000000004`)
        .set(auth('10000000-0000-4000-8000-000000000001'))
        .send({ name: '不应生效的新名称' })
        .expect(403)

      await request(app.getHttpServer())
        .get(`${api}/organizations/00000000-0000-4000-8000-000000000004`)
        .set(auth('10000000-0000-4000-8000-000000000002'))
        .expect(403)
    })

    it('恢复院系 ACTIVE 后，原有分配无需重建即恢复授权与菜单', async () => {
      const versionKey = `${KEY_PREFIX}:version`
      const before = Number(redisFake.store.get(versionKey) ?? '0')

      await patchStatus('00000000-0000-4000-8000-000000000002', 'ACTIVE').expect(200)

      expect(Number(redisFake.store.get(versionKey))).toBeGreaterThan(before)

      const tree = await request(app.getHttpServer())
        .get(`${api}/organizations/tree`)
        .set(auth('10000000-0000-4000-8000-000000000002'))
        .expect(200)

      expect(tree.body.data[0].code).toBe('CS')

      await request(app.getHttpServer())
        .get(`${api}/organizations/00000000-0000-4000-8000-000000000005`)
        .set(auth('10000000-0000-4000-8000-000000000002'))
        .expect(200)

      const menus = await request(app.getHttpServer())
        .get(`${api}/menus/current`)
        .set(auth('10000000-0000-4000-8000-000000000002'))
        .expect(200)

      expect(JSON.stringify(menus.body.data)).toContain('ORGANIZATION_TREE')
      expect(JSON.stringify(menus.body.data)).toContain('STUDENT_PROFILES')
    })

    it('专业停用后：班级从可见树中消失且无法直接访问', async () => {
      await patchStatus('00000000-0000-4000-8000-000000000004', 'DISABLED').expect(200)

      const tree = await request(app.getHttpServer())
        .get(`${api}/organizations/tree`)
        .set(auth('10000000-0000-4000-8000-000000000002'))
        .expect(200)

      expect(tree.body.data[0].code).toBe('CS')
      expect(tree.body.data[0].children).toEqual([])

      await request(app.getHttpServer())
        .get(`${api}/organizations/00000000-0000-4000-8000-000000000005`)
        .set(auth('10000000-0000-4000-8000-000000000002'))
        .expect(403)

      await patchStatus('00000000-0000-4000-8000-000000000004', 'ACTIVE').expect(200)
    })

    it('班级停用后不可访问，恢复后重新可用', async () => {
      await patchStatus('00000000-0000-4000-8000-000000000005', 'DISABLED').expect(200)

      await request(app.getHttpServer())
        .get(`${api}/organizations/00000000-0000-4000-8000-000000000005`)
        .set(auth('10000000-0000-4000-8000-000000000002'))
        .expect(403)

      await patchStatus('00000000-0000-4000-8000-000000000005', 'ACTIVE').expect(200)

      await request(app.getHttpServer())
        .get(`${api}/organizations/00000000-0000-4000-8000-000000000005`)
        .set(auth('10000000-0000-4000-8000-000000000002'))
        .expect(200)
    })
  })

  describe('角色分配提权防护', () => {
    it('学生不能调用角色分配接口', async () => {
      await request(app.getHttpServer())
        .post(`${api}/role-assignments`)
        .set(auth('10000000-0000-4000-8000-000000000004'))
        .send({
          userId: '10000000-0000-4000-8000-000000000004',
          roleCode: 'CLASS_COORDINATOR',
          scopeOrgUnitId: '00000000-0000-4000-8000-000000000005',
        })
        .expect(403)
    })

    it('院系管理员不能分配平台超管', async () => {
      await request(app.getHttpServer())
        .post(`${api}/role-assignments`)
        .set(auth('10000000-0000-4000-8000-000000000002'))
        .send({ userId: '10000000-0000-4000-8000-000000000004', roleCode: 'PLATFORM_SUPER_ADMIN' })
        .expect(403)
    })

    it('院系管理员不能分配对全校生效的教师角色', async () => {
      await request(app.getHttpServer())
        .post(`${api}/role-assignments`)
        .set(auth('10000000-0000-4000-8000-000000000002'))
        .send({ userId: '10000000-0000-4000-8000-000000000004', roleCode: 'TEACHER' })
        .expect(403)
    })

    it('院系管理员不能把协管员分配到自己院系之外', async () => {
      await request(app.getHttpServer())
        .post(`${api}/role-assignments`)
        .set(auth('10000000-0000-4000-8000-000000000002'))
        .send({
          userId: '10000000-0000-4000-8000-000000000004',
          roleCode: 'CLASS_COORDINATOR',
          scopeOrgUnitId: '00000000-0000-4000-8000-000000000006',
        })
        .expect(403)
    })

    it('专业管理员只能分配班级协管员', async () => {
      const assignable = await request(app.getHttpServer())
        .get(`${api}/role-assignments/assignable-roles`)
        .set(auth('10000000-0000-4000-8000-000000000003'))
        .expect(200)

      expect(assignable.body.data.map((item: { code: string }) => item.code)).toEqual([
        'CLASS_COORDINATOR',
      ])

      await request(app.getHttpServer())
        .post(`${api}/role-assignments`)
        .set(auth('10000000-0000-4000-8000-000000000003'))
        .send({
          userId: '10000000-0000-4000-8000-000000000004',
          roleCode: 'DEPARTMENT_ADMIN',
          scopeOrgUnitId: '00000000-0000-4000-8000-000000000002',
        })
        .expect(403)
    })

    it('分配与撤销会提升菜单缓存 generation，并立即影响授权列表', async () => {
      const versionKey = `${KEY_PREFIX}:version`
      const studentId = '10000000-0000-4000-8000-000000000004'

      const before = await request(app.getHttpServer())
        .get(`${api}/menus/current`)
        .set(auth(studentId))
        .expect(200)

      // Phase 1 学生只有个人入口
      expect(JSON.stringify(before.body.data)).toContain('MY_PROFILE')

      const generationBefore = Number(redisFake.store.get(versionKey) ?? '0')

      const created = await request(app.getHttpServer())
        .post(`${api}/role-assignments`)
        .set(auth('10000000-0000-4000-8000-000000000002'))
        .send({
          userId: studentId,
          roleCode: 'CLASS_COORDINATOR',
          scopeOrgUnitId: '00000000-0000-4000-8000-000000000005',
        })
        .expect(201)

      expect(Number(redisFake.store.get(versionKey))).toBeGreaterThan(generationBefore)

      const afterAssign = await request(app.getHttpServer())
        .get(`${api}/role-assignments/users/${studentId}`)
        .set(auth('10000000-0000-4000-8000-000000000002'))
        .expect(200)

      expect(afterAssign.body.data.map((item: { roleCode: string }) => item.roleCode)).toContain(
        'CLASS_COORDINATOR',
      )

      const generationBeforeRevoke = Number(redisFake.store.get(versionKey) ?? '0')

      const revoked = await request(app.getHttpServer())
        .delete(`${api}/role-assignments/${created.body.data.id}`)
        .set(auth('10000000-0000-4000-8000-000000000002'))
        .expect(200)

      // 撤销接口返回被撤销的授权行 ID
      expect(revoked.body.data).toBe(created.body.data.id)
      expect(Number(redisFake.store.get(versionKey))).toBeGreaterThan(generationBeforeRevoke)

      const afterRevoke = await request(app.getHttpServer())
        .get(`${api}/role-assignments/users/${studentId}`)
        .set(auth('10000000-0000-4000-8000-000000000002'))
        .expect(200)

      expect(afterRevoke.body.data).toEqual([])

      // 撤销协管员后学生个人菜单仍然保留
      const menus = await request(app.getHttpServer())
        .get(`${api}/menus/current`)
        .set(auth(studentId))
        .expect(200)

      expect(JSON.stringify(menus.body.data)).toContain('MY_PROFILE')
    })

    it('不能撤销自己的角色分配', async () => {
      const list = await request(app.getHttpServer())
        .get(`${api}/role-assignments/users/10000000-0000-4000-8000-000000000001`)
        .set(auth('10000000-0000-4000-8000-000000000001'))
        .expect(200)

      const own = list.body.data.find(
        (item: { roleCode: string }) => item.roleCode === 'SCHOOL_ADMIN',
      )

      await request(app.getHttpServer())
        .delete(`${api}/role-assignments/${own.id}`)
        .set(auth('10000000-0000-4000-8000-000000000001'))
        .expect(403)
    })

    it('重复分配同一范围角色返回 409', async () => {
      const payload = {
        userId: '10000000-0000-4000-8000-000000000004',
        roleCode: 'CLASS_COORDINATOR',
        scopeOrgUnitId: '00000000-0000-4000-8000-000000000005',
      }

      await request(app.getHttpServer())
        .post(`${api}/role-assignments`)
        .set(auth('10000000-0000-4000-8000-000000000002'))
        .send(payload)
        .expect(201)

      await request(app.getHttpServer())
        .post(`${api}/role-assignments`)
        .set(auth('10000000-0000-4000-8000-000000000002'))
        .send(payload)
        .expect(409)
    })
  })

  describe('用户账号接口权限入口', () => {
    it('未登录访问用户列表 → 401', async () => {
      await request(app.getHttpServer()).get(`${api}/users`).expect(401)
    })

    it('STUDENT 访问用户列表 → 403（不依赖菜单隐藏）', async () => {
      await request(app.getHttpServer())
        .get(`${api}/users`)
        .set(auth('10000000-0000-4000-8000-000000000004'))
        .expect(403)
    })

    it('STUDENT 访问用户详情 → 403', async () => {
      await request(app.getHttpServer())
        .get(`${api}/users/10000000-0000-4000-8000-000000000001`)
        .set(auth('10000000-0000-4000-8000-000000000004'))
        .expect(403)
    })
  })
})
