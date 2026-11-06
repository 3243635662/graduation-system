import 'dotenv/config'
import { DEFAULT_MENU_TREE, type MenuTreeNode } from '@graduation/shared'
import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import * as argon2 from 'argon2'

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

// ==========================================
// 2. Prisma 7 + MariaDB Adapter
// ==========================================

const prisma = new PrismaClient({
  adapter: new PrismaMariaDb(databaseUrl),
})

// ==========================================
// 3. 固定系统角色
// ==========================================

const roles = [
  { code: 'SUPER_ADMIN', name: '超级管理员', description: '拥有系统全部管理权限', isSystem: true },
  {
    code: 'SCHOOL_ADMIN',
    name: '学校管理员',
    description: '负责学校级别的系统管理',
    isSystem: true,
  },
  {
    code: 'DEPARTMENT_ADMIN',
    name: '院系管理员',
    description: '负责院系级别的业务管理',
    isSystem: true,
  },
  { code: 'TEACHER', name: '指导教师', description: '负责毕业设计指导工作', isSystem: true },
  { code: 'STUDENT', name: '学生', description: '参与毕业设计的学生', isSystem: true },
] as const

const ROLE_CODES = roles.map((role) => role.code)

type RoleCode = (typeof roles)[number]['code']

// ==========================================
// 4. 默认角色菜单分配（RoleMenu 只关联 PAGE 节点）
// ==========================================

/**
 * 角色 -> 页面编码的映射
 *
 * 注意：
 * 1. 这里只维护 PAGE 编码，DIRECTORY 仅用于导航分组，不写入 RoleMenu。
 * 2. 菜单树中的角色说明只是注释，不能作为授权依据，授权以本表为准。
 * 3. 本表是「默认初始化」数据，运行 Seed 不会覆盖管理员后续的额外授权。
 */
const ROLE_MENU_CODES: Record<RoleCode, readonly string[]> = {
  SUPER_ADMIN: [
    'DASHBOARD',
    'TOPIC_CENTER',
    'MY_TOPIC',
    'TOPIC_REVIEW',
    'MY_PROJECT',
    'GUIDANCE_STUDENTS',
    'PROCESS_REVIEW',
    'PROCESS_MONITOR',
    'THESIS_SUBMISSION',
    'THESIS_REVIEW',
    'DEFENSE_MANAGEMENT',
    'GRADE_MANAGEMENT',
    'ACHIEVEMENT_ARCHIVE',
    'AI_ASSISTANT',
    'USER_MANAGEMENT',
    'DEPARTMENT_MANAGEMENT',
    'MAJOR_MANAGEMENT',
    'ROLE_MANAGEMENT',
    'MENU_MANAGEMENT',
  ],
  SCHOOL_ADMIN: [
    'DASHBOARD',
    'TOPIC_CENTER',
    'TOPIC_REVIEW',
    'PROCESS_REVIEW',
    'PROCESS_MONITOR',
    'DEFENSE_MANAGEMENT',
    'GRADE_MANAGEMENT',
    'ACHIEVEMENT_ARCHIVE',
    'AI_ASSISTANT',
    'USER_MANAGEMENT',
    'DEPARTMENT_MANAGEMENT',
    'MAJOR_MANAGEMENT',
    'ROLE_MANAGEMENT',
  ],
  DEPARTMENT_ADMIN: [
    'DASHBOARD',
    'TOPIC_CENTER',
    'TOPIC_REVIEW',
    'PROCESS_REVIEW',
    'PROCESS_MONITOR',
    'DEFENSE_MANAGEMENT',
    'GRADE_MANAGEMENT',
    'ACHIEVEMENT_ARCHIVE',
    'AI_ASSISTANT',
    'USER_MANAGEMENT',
    'MAJOR_MANAGEMENT',
  ],
  TEACHER: [
    'DASHBOARD',
    'TOPIC_CENTER',
    'GUIDANCE_STUDENTS',
    'PROCESS_REVIEW',
    'THESIS_REVIEW',
    'DEFENSE_MANAGEMENT',
    'AI_ASSISTANT',
  ],
  STUDENT: [
    'DASHBOARD',
    'TOPIC_CENTER',
    'MY_TOPIC',
    'MY_PROJECT',
    'THESIS_SUBMISSION',
    'AI_ASSISTANT',
  ],
}

/** 各角色默认关联数量，用于启动时校验分配表是否被误改 */
const EXPECTED_ROLE_MENU_COUNTS: Record<RoleCode, number> = {
  SUPER_ADMIN: 19,
  SCHOOL_ADMIN: 13,
  DEPARTMENT_ADMIN: 11,
  TEACHER: 7,
  STUDENT: 6,
}

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

function assertRoleMenuAssignments(pageCodes: Set<string>) {
  let total = 0

  for (const roleCode of ROLE_CODES) {
    const menuCodes = ROLE_MENU_CODES[roleCode]
    const expected = EXPECTED_ROLE_MENU_COUNTS[roleCode]

    if (menuCodes.length !== expected) {
      throw new Error(
        `角色 ${roleCode} 的默认菜单数量为 ${menuCodes.length}，预期 ${expected}，请同步更新 EXPECTED_ROLE_MENU_COUNTS`,
      )
    }

    for (const code of menuCodes) {
      if (!pageCodes.has(code)) {
        throw new Error(`角色 ${roleCode} 引用了不存在的页面编码：${code}`)
      }
    }

    total += menuCodes.length
  }

  if (total !== 56) {
    throw new Error(`默认角色菜单关联总数为 ${total}，预期 56`)
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
// 7. 旧权限数据清理（可选）
// ==========================================

/**
 * 清理暂时不使用的旧权限数据。
 *
 * 通过 CLEAR_LEGACY_PERMISSION_DATA=true 显式启用，
 * 避免后续正常执行 Seed 时误清空已重新建立的权限数据。
 * 只清空数据，不删除表结构。
 */
async function clearLegacyPermissionData() {
  const result = await prisma.$transaction(async (tx) => {
    // 先删除关联记录，再删除权限主体，避免外键约束冲突
    const rolePermissions = await tx.rolePermission.deleteMany()
    const permissions = await tx.permission.deleteMany()

    return {
      rolePermissions: rolePermissions.count,
      permissions: permissions.count,
    }
  })

  console.log(
    `旧权限数据清理完成：RolePermission ${result.rolePermissions} 条，Permission ${result.permissions} 条`,
  )
}

// ==========================================
// 8. Seed 主流程
// ==========================================

async function main() {
  console.log('开始初始化基础数据...')

  // 8.0 按需清理旧权限数据（默认不执行）
  const shouldClearLegacyPermissionData = process.env['CLEAR_LEGACY_PERMISSION_DATA'] === 'true'

  if (shouldClearLegacyPermissionData) {
    await clearLegacyPermissionData()
  }

  // 8.1 校验共享菜单树与角色分配表
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
      // 角色
      const roleIdByCode = new Map<string, string>()

      for (const role of roles) {
        const record = await tx.role.upsert({
          where: { code: role.code },
          create: role,
          update: {
            name: role.name,
            description: role.description,
            isSystem: role.isSystem,
          },
        })

        roleIdByCode.set(role.code, record.id)
      }

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

      await tx.userRole.createMany({
        data: [
          {
            userId: admin.id,
            roleId: roleIdByCode.get('SUPER_ADMIN')!,
            createdById: admin.id,
          },
        ],
        skipDuplicates: true,
      })

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

      for (const roleCode of ROLE_CODES) {
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

      const roleMenuTotal = await tx.roleMenu.count()

      return {
        roleCount: roleIdByCode.size,
        adminEmail: admin.email,
        menuCreated: menuContext.createdCount,
        menuUpdated: menuContext.updatedCount,
        pageCount: menuContext.pageIds.length,
        directoryCount: menuContext.directoryIds.length,
        removedDirectoryLinks: removedDirectoryLinks.count,
        createdRoleMenus: createdRoleMenus.count,
        roleMenuTotal,
      }
    },
    {
      maxWait: 10_000,
      timeout: 30_000,
    },
  )

  console.log(`角色初始化完成：${summary.roleCount} 个`)
  console.log(`超级管理员已就绪：${summary.adminEmail}（密码未重置）`)
  console.log(
    `菜单同步完成：共 ${summary.pageCount + summary.directoryCount} 个（PAGE ${summary.pageCount} / DIRECTORY ${summary.directoryCount}）`,
  )
  console.log(`  - 新增 ${summary.menuCreated} 个，更新 ${summary.menuUpdated} 个`)
  console.log(`目录节点 RoleMenu 关联清理：${summary.removedDirectoryLinks} 条`)
  console.log(
    `角色菜单关联：本次新增 ${summary.createdRoleMenus} 条，当前总数 ${summary.roleMenuTotal} 条`,
  )
  console.log(
    shouldClearLegacyPermissionData
      ? '权限数据已按 CLEAR_LEGACY_PERMISSION_DATA 开关清理'
      : '权限（permissions / role_permissions）未做任何变更',
  )
  console.log('Seed 初始化成功！')
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
