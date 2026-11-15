import { API_PREFIX, type MenuTreeNode } from '@graduation/shared'
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
import { PermissionService } from '../src/modules/rbac/authorization/permission.service.js'
import { OrganizationService } from '../src/modules/rbac/organizations/organization.service.js'
import { PrismaService } from '../src/prisma/prisma.service.js'

const KEY_PREFIX = 'test:e2e:menus'

interface FakeMenu {
  id: string
  code: string
  title: string
  path: string | null
  componentKey: string | null
  icon: string | null
  type: 'DIRECTORY' | 'PAGE'
  parentId: string | null
  sortOrder: number
  visible: boolean
  status: 'ACTIVE' | 'DISABLED'
}

function menu(partial: Partial<FakeMenu> & Pick<FakeMenu, 'id' | 'code' | 'title'>): FakeMenu {
  return {
    path: null,
    componentKey: null,
    icon: null,
    type: 'PAGE',
    parentId: null,
    sortOrder: 1,
    visible: true,
    status: 'ACTIVE',
    ...partial,
  }
}

const MENUS: FakeMenu[] = [
  menu({
    id: 'm-dashboard',
    code: 'DASHBOARD',
    title: '工作台',
    path: '/dashboard',
    componentKey: 'dashboard/index',
    icon: 'LayoutDashboard',
    sortOrder: 1,
  }),
  menu({
    id: 'm-graduation',
    code: 'GRADUATION',
    title: '毕业设计管理',
    type: 'DIRECTORY',
    sortOrder: 10,
  }),
  menu({
    id: 'm-topic-dir',
    code: 'TOPIC_MANAGEMENT',
    title: '选题管理',
    type: 'DIRECTORY',
    parentId: 'm-graduation',
    sortOrder: 1,
  }),
  menu({
    id: 'm-topic-center',
    code: 'TOPIC_CENTER',
    title: '课题中心',
    path: '/topics',
    componentKey: 'topics/index',
    parentId: 'm-topic-dir',
    sortOrder: 1,
  }),
  menu({
    id: 'm-my-topic',
    code: 'MY_TOPIC',
    title: '我的选题',
    path: '/topics/my',
    componentKey: 'topics/my',
    parentId: 'm-topic-dir',
    sortOrder: 2,
  }),
  menu({
    id: 'm-my-project',
    code: 'MY_PROJECT',
    title: '我的毕设',
    path: '/projects/my',
    componentKey: 'projects/my',
    parentId: 'm-graduation',
    sortOrder: 2,
  }),
  menu({ id: 'm-system', code: 'SYSTEM', title: '系统管理', type: 'DIRECTORY', sortOrder: 20 }),
  menu({
    id: 'm-menus',
    code: 'MENUS',
    title: '菜单管理',
    path: '/menus',
    componentKey: 'menus/index',
    parentId: 'm-system',
    sortOrder: 1,
  }),
  menu({
    id: 'm-hidden',
    code: 'HIDDEN_PAGE',
    title: '隐藏页面',
    path: '/hidden',
    componentKey: 'hidden/index',
    parentId: 'm-system',
    sortOrder: 2,
    visible: false,
  }),
  menu({
    id: 'm-disabled',
    code: 'DISABLED_PAGE',
    title: '已停用页面',
    path: '/disabled-page',
    componentKey: 'disabled/index',
    parentId: 'm-system',
    sortOrder: 3,
    status: 'DISABLED',
  }),
  menu({
    id: 'm-broken',
    code: 'BROKEN_PAGE',
    title: '缺少组件',
    path: '/broken',
    componentKey: null,
    parentId: 'm-system',
    sortOrder: 4,
  }),
]

const ROLES = [
  { id: 'role-student', code: 'STUDENT', status: 'ACTIVE' },
  { id: 'role-teacher', code: 'TEACHER', status: 'ACTIVE' },
  { id: 'role-admin', code: 'SUPER_ADMIN', status: 'ACTIVE' },
  { id: 'role-disabled', code: 'SCHOOL_ADMIN', status: 'DISABLED' },
] as const

const USER_ROLES: Array<{ userId: string; roleId: string }> = [
  { userId: 'user-student-a', roleId: 'role-student' },
  // student-b 多角色：同一菜单被两个角色重复授权
  { userId: 'user-student-b', roleId: 'role-student' },
  { userId: 'user-student-b', roleId: 'role-teacher' },
  { userId: 'user-admin', roleId: 'role-admin' },
  // 停用角色不应参与菜单计算
  { userId: 'user-admin', roleId: 'role-disabled' },
]

const ROLE_MENUS: Array<{ roleId: string; menuId: string }> = [
  ...['m-dashboard', 'm-topic-center', 'm-my-topic', 'm-my-project'].map((menuId) => ({
    roleId: 'role-student',
    menuId,
  })),
  ...['m-topic-center', 'm-my-project'].map((menuId) => ({ roleId: 'role-teacher', menuId })),
  ...[
    'm-dashboard',
    'm-topic-center',
    'm-my-topic',
    'm-my-project',
    'm-menus',
    'm-hidden',
    'm-disabled',
    'm-broken',
  ].map((menuId) => ({ roleId: 'role-admin', menuId })),
]

const SESSIONS = [
  { id: 'session-a', userId: 'user-student-a' },
  { id: 'session-b', userId: 'user-student-b' },
  { id: 'session-admin', userId: 'user-admin' },
]

function createPrismaFake() {
  const calls = { menuFindMany: 0, userRoleFindMany: 0, roleMenuFindMany: 0 }

  return {
    calls,
    authSession: {
      async findUnique({ where }: { where: { id: string } }) {
        const session = SESSIONS.find((item) => item.id === where.id)

        if (!session) return null

        return {
          id: session.id,
          revokedAt: null,
          expiresAt: new Date(Date.now() + 3_600_000),
          user: { id: session.userId, status: 'ACTIVE' },
        }
      },
    },
    user: {
      async findUnique() {
        return { status: 'ACTIVE', deletedAt: null }
      },
    },
    userRole: {
      async findMany({ where }: { where: { userId: string; role?: { status: string } } }) {
        calls.userRoleFindMany += 1

        // 显式声明为 Set<string>：ROLES 使用了 as const，否则会推断成字面量联合类型，
        // 导致 has(item.roleId)（string）报 TypeScript 错误
        const activeRoleIds = new Set<string>(
          ROLES.filter((role) => !where.role || role.status === where.role.status).map(
            (role) => role.id,
          ),
        )

        // PermissionService 需要完整角色信息来判定有效性
        return USER_ROLES.filter(
          (item) => item.userId === where.userId && activeRoleIds.has(item.roleId),
        ).map((item) => {
          const role = ROLES.find((candidate) => candidate.id === item.roleId)!

          return {
            id: `${item.userId}:${item.roleId}`,
            roleId: item.roleId,
            scopeOrgUnitId: null,
            validFrom: new Date(0),
            validUntil: null,
            role: {
              code: role.code,
              name: role.code,
              dataScope: 'SELF' as const,
              status: role.status,
            },
          }
        })
      },
    },
    roleMenu: {
      async findMany({ where }: { where: { roleId: { in: string[] } } }) {
        calls.roleMenuFindMany += 1

        return ROLE_MENUS.filter((item) => where.roleId.in.includes(item.roleId)).map((item) => ({
          menuId: item.menuId,
        }))
      },
    },
    menu: {
      async findMany({ where }: { where: { id: { in: string[] } } }) {
        calls.menuFindMany += 1

        return MENUS.filter((item) => where.id.in.includes(item.id))
      },
    },
  }
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

function collectPages(nodes: MenuTreeNode[]): MenuTreeNode[] {
  return nodes.flatMap((node) =>
    node.type === 'PAGE' ? [node] : collectPages(node.children ?? []),
  )
}

describe('Menus (e2e)', () => {
  let app: INestApplication<App>
  let tokenService: TokenService
  let prismaFake: ReturnType<typeof createPrismaFake>
  let redisFake: ReturnType<typeof createRedisFake>

  const apiUrl = `/${API_PREFIX}/menus/current`

  function tokenFor(userId: string, sessionId: string): string {
    return tokenService.signAccessToken(userId, sessionId)
  }

  function getMenus(token: string, query = '') {
    return request(app.getHttpServer())
      .get(`${apiUrl}${query}`)
      .set('Authorization', `Bearer ${token}`)
  }

  beforeAll(async () => {
    process.env['JWT_ACCESS_SECRET'] = 'menus-e2e-secret'
    process.env['ACCESS_TOKEN_TTL_SECONDS'] = '900'
    process.env['MENU_CACHE_KEY_PREFIX'] = KEY_PREFIX

    prismaFake = createPrismaFake()
    redisFake = createRedisFake()

    const moduleFixture = await Test.createTestingModule({
      controllers: [MenusController],
      providers: [
        { provide: PrismaService, useValue: prismaFake },
        { provide: REDIS_CLIENT, useValue: redisFake.client },
        RedisService,
        MenuCacheService,
        MenuCacheInvalidatorService,
        MenusService,
        PermissionService,
        OrganizationService,
        {
          provide: CoordinatorEligibilityService,
          useValue: {
            filterAssignments: async (_userId: string, assignments: unknown[]) => ({
              assignments,
              nextExpiry: null,
            }),
          },
        },
        TokenService,
        AccessTokenGuard,
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

  it('未登录返回 401 且不暴露任何菜单', async () => {
    await request(app.getHttpServer())
      .get(apiUrl)
      .expect(401)
      .expect(({ body }) => {
        expect(body.code).toBe(40101)
        expect(body.data).toBeNull()
      })
  })

  it('学生 A 只能拿到学校授权给自己的页面，并自动补齐目录', async () => {
    const response = await getMenus(tokenFor('user-student-a', 'session-a')).expect(200)

    const tree = response.body.data as MenuTreeNode[]

    expect(
      collectPages(tree)
        .map((page) => page.code)
        .toSorted(),
    ).toEqual(['DASHBOARD', 'MY_PROJECT', 'MY_TOPIC', 'TOPIC_CENTER'])

    // 根级顺序：DASHBOARD(1) 在 GRADUATION(10) 之前
    expect(tree.map((node) => node.code)).toEqual(['DASHBOARD', 'GRADUATION'])
    expect(tree[1]?.children?.map((node) => node.code)).toEqual(['TOPIC_MANAGEMENT', 'MY_PROJECT'])
  })

  it('多角色用户合并去重后菜单不重复', async () => {
    const response = await getMenus(tokenFor('user-student-b', 'session-b')).expect(200)

    const pages = collectPages(response.body.data as MenuTreeNode[])

    expect(pages.map((page) => page.code).toSorted()).toEqual([
      'DASHBOARD',
      'MY_PROJECT',
      'MY_TOPIC',
      'TOPIC_CENTER',
    ])
    expect(new Set(pages.map((page) => page.code)).size).toBe(pages.length)
  })

  it('超级管理员拿到管理菜单，并过滤停用 / 缺少 componentKey 的页面', async () => {
    const response = await getMenus(tokenFor('user-admin', 'session-admin')).expect(200)

    const pages = collectPages(response.body.data as MenuTreeNode[])

    expect(pages.map((page) => page.code).toSorted()).toEqual([
      'DASHBOARD',
      'HIDDEN_PAGE',
      'MENUS',
      'MY_PROJECT',
      'MY_TOPIC',
      'TOPIC_CENTER',
    ])
    // 停用角色（SCHOOL_ADMIN）不参与计算，也没有额外页面
    expect(pages.some((page) => page.code === 'DISABLED_PAGE')).toBe(false)
    expect(pages.some((page) => page.code === 'BROKEN_PAGE')).toBe(false)
  })

  it('visible=false 的页面仍返回授权数据，交由前端隐藏侧边栏', async () => {
    const response = await getMenus(tokenFor('user-admin', 'session-admin')).expect(200)

    const hidden = collectPages(response.body.data as MenuTreeNode[]).find(
      (page) => page.code === 'HIDDEN_PAGE',
    )

    expect(hidden?.visible).toBe(false)
  })

  it('不同用户的缓存 Key 相互隔离', async () => {
    await getMenus(tokenFor('user-student-a', 'session-a')).expect(200)
    await getMenus(tokenFor('user-student-b', 'session-b')).expect(200)

    const version = redisFake.store.get(`${KEY_PREFIX}:version`) ?? '0'

    expect(redisFake.store.has(`${KEY_PREFIX}:v1:g${version}:user:user-student-a`)).toBe(true)
    expect(redisFake.store.has(`${KEY_PREFIX}:v1:g${version}:user:user-student-b`)).toBe(true)
  })

  it('第二次请求命中缓存，不再查询角色菜单', async () => {
    await getMenus(tokenFor('user-admin', 'session-admin')).expect(200)

    const before = prismaFake.calls.roleMenuFindMany

    await getMenus(tokenFor('user-admin', 'session-admin')).expect(200)

    expect(prismaFake.calls.roleMenuFindMany).toBe(before)
  })

  it('客户端传入 roleId / userId 不会影响菜单结果', async () => {
    const injected = await getMenus(
      tokenFor('user-student-a', 'session-a'),
      '?userId=user-admin&roleId=role-admin',
    ).expect(200)

    expect(
      collectPages(injected.body.data as MenuTreeNode[])
        .map((page) => page.code)
        .toSorted(),
    ).toEqual(['DASHBOARD', 'MY_PROJECT', 'MY_TOPIC', 'TOPIC_CENTER'])
  })

  it('响应禁止共享缓存', async () => {
    const response = await getMenus(tokenFor('user-student-a', 'session-a')).expect(200)

    expect(response.headers['cache-control']).toBe('private, no-store')
  })

  it('提升 generation 后旧缓存不再使用', async () => {
    const token = tokenFor('user-student-a', 'session-a')

    await getMenus(token).expect(200)

    const coldGeneration = Number(redisFake.store.get(`${KEY_PREFIX}:version`) ?? '0')

    await redisFake.client.incr(`${KEY_PREFIX}:version`)

    const before = prismaFake.calls.roleMenuFindMany

    await getMenus(token).expect(200)

    expect(prismaFake.calls.roleMenuFindMany).toBeGreaterThan(before)
    expect(redisFake.store.has(`${KEY_PREFIX}:v1:g${coldGeneration + 1}:user:user-student-a`)).toBe(
      true,
    )
  })
})
