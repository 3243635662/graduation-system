import 'dotenv/config'
import {
  DEFAULT_MENU_CACHE_KEY_PREFIX,
  DEFAULT_MENU_TREE,
  LEGACY_SUPER_ADMIN_ROLE_CODE,
  PRESET_PERMISSIONS,
  PRESET_ROLES,
  ROLE_MENU_CODES,
  ROLE_PERMISSION_CODES,
  RoleCode,
  buildMenuCacheVersionKey,
  type MenuTreeNode,
} from '@graduation/shared'
import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import * as argon2 from 'argon2'
import { createClient } from 'redis'

import { Prisma, PrismaClient } from '../generated/prisma/client.js'

// ==========================================
// 1. 环境变量检查
// ==========================================

const requiredEnv = [
  'DATABASE_URL',
  'SUPER_ADMIN_EMAIL',
  'SUPER_ADMIN_PASSWORD',
  'SUPER_ADMIN_DISPLAY_NAME',
] as const

for (const key of requiredEnv) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`)
  }
}

const databaseUrl = process.env['DATABASE_URL']!
const adminEmail = process.env['SUPER_ADMIN_EMAIL']!
const adminPassword = process.env['SUPER_ADMIN_PASSWORD']!
const adminDisplayName = process.env['SUPER_ADMIN_DISPLAY_NAME']!

/**
 * 学校根组织信息。
 *
 * 单学校系统只允许一个 SCHOOL 根节点；已存在时保留管理员维护过的名称，
 * 不会用环境变量覆盖，避免 Seed 篡改线上组织数据。
 */
const schoolName = process.env['SCHOOL_NAME']?.trim() || '示范大学'
const schoolCode = process.env['SCHOOL_CODE']?.trim() || 'SCHOOL-ROOT'

// ==========================================
// 2. Prisma 7 + MariaDB Adapter
// ==========================================

const prisma = new PrismaClient({
  adapter: new PrismaMariaDb(databaseUrl),
})

// ==========================================
// 3. 预置角色与授权矩阵（唯一来源：@graduation/shared）
// ==========================================
//
// 角色是职责模板，彼此平级，不存在继承关系。
// 管理边界由 UserRole.scopeOrgUnitId 决定，而不是角色层级。
// 菜单矩阵、权限矩阵与角色定义全部维护在 shared 的 constants/rbac.ts，
// Seed 只负责把它们幂等写入数据库。
//
// 旧版 SUPER_ADMIN 不在七角色之列：它的角色行保留用于审计，
// 但状态改为 DISABLED，且不再产生任何新的分配。

// ==========================================
// 4. 角色菜单 / 权限分配校验
// ==========================================

// ==========================================
// 5. 菜单树工具
// ==========================================

interface MenuNodeStats {
  pages: number
  directories: number
  codes: string[]
}

function collectMenuStats(nodes: MenuTreeNode[]): MenuNodeStats {
  const stats: MenuNodeStats = { pages: 0, directories: 0, codes: [] }

  for (const node of nodes) {
    stats.codes.push(node.code)

    if (node.type === 'PAGE') {
      stats.pages += 1
    } else {
      stats.directories += 1
    }

    if (node.children?.length) {
      const childStats = collectMenuStats(node.children)
      stats.pages += childStats.pages
      stats.directories += childStats.directories
      stats.codes.push(...childStats.codes)
    }
  }

  return stats
}

/** 校验共享菜单树的结构约定，避免脏数据写入数据库 */
function assertMenuTree(nodes: MenuTreeNode[]) {
  for (const node of nodes) {
    if (node.type === 'PAGE') {
      if (!node.path) {
        throw new Error(`菜单 ${node.code} 是 PAGE，但缺少 path`)
      }
      if (!node.componentKey) {
        throw new Error(`菜单 ${node.code} 是 PAGE，但缺少 componentKey`)
      }
    } else {
      if (node.path !== null) {
        throw new Error(`菜单 ${node.code} 是 DIRECTORY，path 必须为 null`)
      }
      if (node.componentKey) {
        throw new Error(`菜单 ${node.code} 是 DIRECTORY，componentKey 必须为空`)
      }
    }

    if (node.children?.length) {
      assertMenuTree(node.children)
    }
  }
}

function collectPageCodes(nodes: MenuTreeNode[]): Set<string> {
  const codes = new Set<string>()

  const walk = (list: MenuTreeNode[]) => {
    for (const node of list) {
      if (node.type === 'PAGE') {
        codes.add(node.code)
      }
      if (node.children?.length) {
        walk(node.children)
      }
    }
  }

  walk(nodes)

  return codes
}

/** 只允许学生拥有的个人业务页面 */
const STUDENT_ONLY_PAGES = ['MY_TOPIC', 'MY_PROJECT', 'THESIS_SUBMISSION'] as const

/** 不属于班级协管员职责的管理页面 */
const COORDINATOR_FORBIDDEN_PAGES = [
  'USER_MANAGEMENT',
  'ROLE_MANAGEMENT',
  'MENU_MANAGEMENT',
  'DEPARTMENT_MANAGEMENT',
  'MAJOR_MANAGEMENT',
] as const

/**
 * 校验角色菜单矩阵，防止共享常量被误改。
 *
 * 这里校验的是业务原则，而不是「数量必须等于某个数字」：
 * 后续为协管员新增专属页面时不需要修改本函数。
 */
function assertRoleMenuAssignments(pageCodes: Set<string>) {
  const roleCodes = Object.keys(ROLE_MENU_CODES) as RoleCode[]

  if (roleCodes.length !== PRESET_ROLES.length) {
    throw new Error('角色菜单矩阵必须与预置角色一一对应')
  }

  for (const roleCode of roleCodes) {
    const menuCodes = ROLE_MENU_CODES[roleCode]

    if (new Set(menuCodes).size !== menuCodes.length) {
      throw new Error(`角色 ${roleCode} 的菜单配置存在重复项`)
    }

    for (const code of menuCodes) {
      if (!pageCodes.has(code)) {
        throw new Error(`角色 ${roleCode} 引用了不存在的页面编码：${code}`)
      }
    }

    if (roleCode !== RoleCode.STUDENT) {
      for (const code of STUDENT_ONLY_PAGES) {
        if (menuCodes.includes(code)) {
          throw new Error(`非学生角色 ${roleCode} 不能拥有学生个人业务页面 ${code}`)
        }
      }
    }

    if (roleCode !== RoleCode.TEACHER && menuCodes.includes('GUIDANCE_STUDENTS')) {
      throw new Error(`只有教师角色可以拥有指导页面，冲突角色：${roleCode}`)
    }

    if (roleCode === RoleCode.CLASS_COORDINATOR) {
      for (const code of COORDINATOR_FORBIDDEN_PAGES) {
        if (menuCodes.includes(code)) {
          throw new Error(`班级协管员不能拥有管理页面 ${code}`)
        }
      }
    }

    if (
      roleCode === RoleCode.STUDENT &&
      menuCodes.some((code) => code.includes('REVIEW') || code === 'USER_MANAGEMENT')
    ) {
      throw new Error('学生角色不能拥有审核或用户管理页面')
    }
  }
}

// ==========================================
// 6. 菜单同步
// ==========================================

interface MenuSyncContext {
  tx: Prisma.TransactionClient
  existingCodes: Set<string>
  menuIdByCode: Map<string, string>
  directoryIds: string[]
  pageIds: string[]
  createdCount: number
  updatedCount: number
  createdById: string
}

async function syncMenuTree(
  context: MenuSyncContext,
  nodes: MenuTreeNode[],
  parentId: string | null,
) {
  for (const node of nodes) {
    const data = {
      title: node.title,
      path: node.path,
      componentKey: node.componentKey ?? null,
      icon: node.icon ?? null,
      type: node.type,
      parentId,
      sortOrder: node.sortOrder,
      visible: node.visible ?? true,
      status: 'ACTIVE' as const,
    }

    const existed = context.existingCodes.has(node.code)

    const record = await context.tx.menu.upsert({
      where: { code: node.code },
      create: {
        code: node.code,
        ...data,
        createdById: context.createdById,
      },
      update: data,
    })

    if (existed) {
      context.updatedCount += 1
    } else {
      context.createdCount += 1
    }

    context.menuIdByCode.set(node.code, record.id)

    if (record.type === 'DIRECTORY') {
      context.directoryIds.push(record.id)
    } else {
      context.pageIds.push(record.id)
    }

    if (node.children?.length) {
      await syncMenuTree(context, node.children, record.id)
    }
  }
}

// ==========================================
// 7. Seed 主流程
// ==========================================
//
// 明确不提供「清空权限数据」的开关：权限与角色关联只能增量维护，
// 任何全量删除都会让管理员已有的授权静默丢失。

async function main() {
  console.log('开始初始化基础数据...')

  // 7.1 校验共享菜单树与角色分配表
  assertMenuTree(DEFAULT_MENU_TREE)

  const menuStats = collectMenuStats(DEFAULT_MENU_TREE)
  const pageCodeSet = collectPageCodes(DEFAULT_MENU_TREE)

  assertRoleMenuAssignments(pageCodeSet)

  console.log(
    `菜单树校验通过：共 ${menuStats.codes.length} 个节点（PAGE ${menuStats.pages} / DIRECTORY ${menuStats.directories}）`,
  )

  // 8.2 密码只在首次创建时生效，重复执行不会重置
  const passwordHash = await argon2.hash(adminPassword, {
    type: argon2.argon2id,
  })

  // 8.3 单个事务内完成角色、账号、菜单与角色菜单关联
  const summary = await prisma.$transaction(
    async (tx) => {
      // 七个预置角色：职责平级，dataScope 只描述范围维度
      const roleIdByCode = new Map<RoleCode, string>()

      for (const role of PRESET_ROLES) {
        const record = await tx.role.upsert({
          where: { code: role.code },
          create: {
            code: role.code,
            name: role.name,
            description: role.description,
            dataScope: role.dataScope,
            isSystem: true,
            status: 'ACTIVE',
          },
          update: {
            name: role.name,
            description: role.description,
            dataScope: role.dataScope,
            isSystem: true,
            status: 'ACTIVE',
          },
        })

        roleIdByCode.set(role.code, record.id)
      }

      /**
       * 旧 SUPER_ADMIN 角色模板：保留行与其历史 RoleMenu 关联用于审计，
       * 只标记为停用，绝不删除，避免丢失「迁移前授权过什么」的证据。
       */
      const legacyRole = await tx.role.updateMany({
        where: { code: LEGACY_SUPER_ADMIN_ROLE_CODE },
        data: { status: 'DISABLED' },
      })

      // 超级管理员账号（保留原密码）
      const admin = await tx.user.upsert({
        where: { email: adminEmail },
        create: {
          email: adminEmail,
          passwordHash,
          displayName: adminDisplayName,
          status: 'ACTIVE',
        },
        update: {},
      })

      /**
       * 学校根组织（单学校系统只允许一个 SCHOOL 节点）
       *
       * 已存在时保留管理员维护过的名称与编码，不用环境变量覆盖。
       */
      let school = await tx.organizationUnit.findFirst({
        where: { type: 'SCHOOL' },
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true, code: true },
      })

      const schoolCreated = !school

      if (!school) {
        school = await tx.organizationUnit.create({
          data: {
            name: schoolName,
            code: schoolCode,
            type: 'SCHOOL',
            sortOrder: 0,
            createdById: admin.id,
          },
          select: { id: true, name: true, code: true },
        })
      }

      /**
       * 旧 SUPER_ADMIN → SCHOOL_ADMIN 迁移（已确认：该账号是学校工作人员日常账号）
       *
       * 安全规则：
       * 1. 不删除 User、不删除 AuthSession、不删除旧的 UserRole 记录。
       * 2. 旧分配只标记 revokedAt / revokedById，保留完整历史。
       * 3. 新分配绑定学校根组织，不给予学生个人业务菜单。
       * 4. 幂等：已存在有效 SCHOOL_ADMIN 分配时不会重复创建；
       *    管理员日后主动撤销后，Seed 也不会重新激活。
       */
      const legacyRoleRecord = await tx.role.findUnique({
        where: { code: LEGACY_SUPER_ADMIN_ROLE_CODE },
        select: { id: true },
      })

      let revokedLegacyAssignments = 0

      if (legacyRoleRecord) {
        const revoked = await tx.userRole.updateMany({
          where: {
            userId: admin.id,
            roleId: legacyRoleRecord.id,
            revokedAt: null,
          },
          data: {
            revokedAt: new Date(),
            revokedById: admin.id,
          },
        })

        revokedLegacyAssignments = revoked.count
      }

      const schoolAdminRoleId = roleIdByCode.get(RoleCode.SCHOOL_ADMIN)!

      const existingSchoolAdminAssignment = await tx.userRole.findFirst({
        where: {
          userId: admin.id,
          roleId: schoolAdminRoleId,
          scopeOrgUnitId: school.id,
          revokedAt: null,
        },
        select: { id: true },
      })

      const adminAssignmentCount = await tx.userRole.count({
        where: { userId: admin.id },
      })

      let schoolAdminAssigned = false

      /**
       * 仅在两种情况下创建学校管理员分配：
       * - 本次刚撤销了旧超管（真实迁移场景）
       * - 该账号历史上一无所有（全新环境首次初始化）
       */
      if (
        !existingSchoolAdminAssignment &&
        (revokedLegacyAssignments > 0 || adminAssignmentCount === 0)
      ) {
        await tx.userRole.create({
          data: {
            userId: admin.id,
            roleId: schoolAdminRoleId,
            scopeOrgUnitId: school.id,
            assignedById: admin.id,
            createdById: admin.id,
          },
        })

        schoolAdminAssigned = true
      }

      // 菜单树
      const existingMenus = await tx.menu.findMany({ select: { code: true } })

      const menuContext: MenuSyncContext = {
        tx,
        existingCodes: new Set(existingMenus.map((menu) => menu.code)),
        menuIdByCode: new Map<string, string>(),
        directoryIds: [],
        pageIds: [],
        createdCount: 0,
        updatedCount: 0,
        createdById: admin.id,
      }

      await syncMenuTree(menuContext, DEFAULT_MENU_TREE, null)

      // 清理目录节点的 RoleMenu 关联（RoleMenu 只保留 PAGE）
      const removedDirectoryLinks = await tx.roleMenu.deleteMany({
        where: { menuId: { in: menuContext.directoryIds } },
      })

      // 补齐默认角色菜单关联，已有 PAGE 关联保留
      const roleMenuData: Prisma.RoleMenuCreateManyInput[] = []

      for (const roleCode of Object.keys(ROLE_MENU_CODES) as RoleCode[]) {
        const roleId = roleIdByCode.get(roleCode)

        if (!roleId) {
          throw new Error(`角色 ${roleCode} 初始化失败，未取得角色 ID`)
        }

        for (const menuCode of ROLE_MENU_CODES[roleCode]) {
          const menuId = menuContext.menuIdByCode.get(menuCode)

          if (!menuId) {
            throw new Error(`角色 ${roleCode} 引用的菜单 ${menuCode} 未同步到数据库`)
          }

          roleMenuData.push({
            roleId,
            menuId,
            createdById: admin.id,
          })
        }
      }

      const createdRoleMenus = await tx.roleMenu.createMany({
        data: roleMenuData,
        skipDuplicates: true,
      })

      // 预置权限：按 code 作为稳定标识幂等 upsert
      const permissionIdByCode = new Map<string, string>()

      for (const permission of PRESET_PERMISSIONS) {
        const record = await tx.permission.upsert({
          where: { code: permission.code },
          create: {
            code: permission.code,
            name: permission.name,
            moduleName: permission.moduleName,
            action: permission.action,
            description: permission.description,
            createdById: admin.id,
          },
          update: {
            name: permission.name,
            moduleName: permission.moduleName,
            action: permission.action,
            description: permission.description,
          },
        })

        permissionIdByCode.set(permission.code, record.id)
      }

      /**
       * 角色 → 权限：只增不删。
       *
       * Seed 不删除任何 RolePermission，避免覆盖管理员后续追加的授权；
       * 需要收回权限时应通过管理操作显式执行。
       */
      const rolePermissionData: Prisma.RolePermissionCreateManyInput[] = []

      for (const roleCode of Object.keys(ROLE_PERMISSION_CODES) as RoleCode[]) {
        const roleId = roleIdByCode.get(roleCode)

        if (!roleId) {
          throw new Error(`角色 ${roleCode} 初始化失败，未取得角色 ID`)
        }

        for (const permissionCode of ROLE_PERMISSION_CODES[roleCode]) {
          const permissionId = permissionIdByCode.get(permissionCode)

          if (!permissionId) {
            throw new Error(`角色 ${roleCode} 引用了未初始化的权限 ${permissionCode}`)
          }

          rolePermissionData.push({
            roleId,
            permissionId,
            createdById: admin.id,
          })
        }
      }

      const createdRolePermissions = await tx.rolePermission.createMany({
        data: rolePermissionData,
        skipDuplicates: true,
      })

      const [roleMenuTotal, rolePermissionTotal, permissionTotal] = await Promise.all([
        tx.roleMenu.count(),
        tx.rolePermission.count(),
        tx.permission.count(),
      ])

      return {
        roleCount: roleIdByCode.size,
        adminEmail: admin.email,
        schoolName: school.name,
        schoolCode: school.code,
        schoolCreated,
        legacyRoleDisabled: legacyRole.count,
        revokedLegacyAssignments,
        schoolAdminAssigned,
        schoolAdminScopeName: school.name,
        menuCreated: menuContext.createdCount,
        menuUpdated: menuContext.updatedCount,
        pageCount: menuContext.pageIds.length,
        directoryCount: menuContext.directoryIds.length,
        removedDirectoryLinks: removedDirectoryLinks.count,
        createdRoleMenus: createdRoleMenus.count,
        roleMenuTotal,
        permissionTotal,
        createdRolePermissions: createdRolePermissions.count,
        rolePermissionTotal,
      }
    },
    {
      maxWait: 10_000,
      timeout: 30_000,
    },
  )

  console.log(`角色初始化完成：${summary.roleCount} 个`)
  console.log(
    `学校根组织已就绪：${summary.schoolName}（${summary.schoolCode}）${
      summary.schoolCreated ? '，本次新建' : '，沿用已有记录'
    }`,
  )
  console.log(`管理员账号已就绪：${summary.adminEmail}（密码未重置）`)

  if (summary.legacyRoleDisabled > 0) {
    console.log('旧 SUPER_ADMIN 角色模板已停用（保留历史 RoleMenu 关联用于审计）')
  }

  if (summary.revokedLegacyAssignments > 0) {
    console.log(
      `旧 SUPER_ADMIN 分配已撤销 ${summary.revokedLegacyAssignments} 条（记录保留，未删除）`,
    )
  }

  console.log(
    summary.schoolAdminAssigned
      ? `已分配 SCHOOL_ADMIN（范围：${summary.schoolAdminScopeName}）`
      : 'SCHOOL_ADMIN 分配已存在或曾被人为撤销，本次未改动',
  )

  console.log(
    `菜单同步完成：共 ${summary.pageCount + summary.directoryCount} 个（PAGE ${summary.pageCount} / DIRECTORY ${summary.directoryCount}）`,
  )
  console.log(`  - 新增 ${summary.menuCreated} 个，更新 ${summary.menuUpdated} 个`)
  console.log(`目录节点 RoleMenu 关联清理：${summary.removedDirectoryLinks} 条`)
  console.log(
    `角色菜单关联：本次新增 ${summary.createdRoleMenus} 条，当前总数 ${summary.roleMenuTotal} 条`,
  )
  console.log(
    `权限初始化：${summary.permissionTotal} 个权限；角色权限本次新增 ${summary.createdRolePermissions} 条，当前总数 ${summary.rolePermissionTotal} 条`,
  )
  const cacheInvalidated = await invalidateMenuCacheAfterSeed()
  console.log(
    cacheInvalidated
      ? '菜单缓存版本已提升：所有用户的菜单缓存将在下次请求时重建'
      : '警告：菜单缓存版本提升失败，旧缓存将在 TTL（600～660 秒）后自然过期',
  )
  console.log('Seed 初始化成功！')
}

/**
 * Seed 结束后提升菜单缓存版本
 *
 * Seed 直接连接数据库、不经过 NestJS 的 DI 容器，因此这里用一次性 Redis 客户端
 * 执行与 MenuCacheInvalidatorService 相同的 INCR。
 *
 * 失败只告警不中断：Seed 已经提交，旧缓存由 TTL（600～660 秒）兜底回收。
 */
async function invalidateMenuCacheAfterSeed(): Promise<boolean> {
  const keyPrefix = process.env['MENU_CACHE_KEY_PREFIX']?.trim() || DEFAULT_MENU_CACHE_KEY_PREFIX

  const client = createClient({
    socket: {
      host: process.env['REDIS_HOST']?.trim() || '127.0.0.1',
      port: Number(process.env['REDIS_PORT'] ?? 6379),
      connectTimeout: 3_000,
      reconnectStrategy: () => false,
    },
    username: process.env['REDIS_USERNAME']?.trim() || undefined,
    password: process.env['REDIS_PASSWORD'] || undefined,
    database: Number(process.env['REDIS_DB'] ?? 0),
    disableOfflineQueue: true,
  })

  client.on('error', () => undefined)

  try {
    await client.connect()

    const generation = await client.incr(buildMenuCacheVersionKey(keyPrefix))

    console.log(`菜单缓存 generation = ${generation}`)

    await client.quit()

    return true
  } catch (error) {
    console.warn('菜单缓存版本提升失败：', error instanceof Error ? error.message : String(error))

    try {
      client.destroy()
    } catch {
      // 连接已关闭时忽略
    }

    return false
  }
}

// ==========================================
// 9. 执行与资源释放
// ==========================================

main()
  .catch((error: unknown) => {
    console.error('Seed 初始化失败：', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
