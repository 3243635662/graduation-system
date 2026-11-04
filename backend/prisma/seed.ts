import 'dotenv/config'
import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import * as argon2 from 'argon2'

import { PrismaClient } from '../generated/prisma/client.js'

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

const adapter = new PrismaMariaDb(databaseUrl)

const prisma = new PrismaClient({
  adapter,
})

// ==========================================
// 3. 基础角色
// ==========================================

const roles = [
  {
    code: 'SUPER_ADMIN',
    name: '超级管理员',
    description: '拥有系统全部管理权限',
    isSystem: true,
  },
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
  {
    code: 'TEACHER',
    name: '指导教师',
    description: '负责毕业设计指导工作',
    isSystem: true,
  },
  {
    code: 'STUDENT',
    name: '学生',
    description: '参与毕业设计的学生',
    isSystem: true,
  },
] as const

// ==========================================
// 4. 基础权限
// ==========================================

const modules = [
  {
    moduleName: 'user',
    moduleLabel: '用户管理',
    actions: [
      ['list', '查看用户'],
      ['create', '创建用户'],
      ['update', '修改用户'],
      ['delete', '删除用户'],
    ],
  },
  {
    moduleName: 'role',
    moduleLabel: '角色管理',
    actions: [
      ['list', '查看角色'],
      ['create', '创建角色'],
      ['update', '修改角色'],
      ['delete', '删除角色'],
    ],
  },
  {
    moduleName: 'menu',
    moduleLabel: '菜单管理',
    actions: [
      ['list', '查看菜单'],
      ['create', '创建菜单'],
      ['update', '修改菜单'],
      ['delete', '删除菜单'],
    ],
  },
  {
    moduleName: 'permission',
    moduleLabel: '权限管理',
    actions: [
      ['list', '查看权限'],
      ['create', '创建权限'],
      ['update', '修改权限'],
      ['delete', '删除权限'],
    ],
  },
] as const

const permissions = modules.flatMap((module) =>
  module.actions.map(([action, actionLabel]) => ({
    code: `${module.moduleName}:${action}`,
    name: actionLabel,
    moduleName: module.moduleName,
    action,
    description: `${module.moduleLabel} - ${actionLabel}`,
  })),
)

// ==========================================
// 5. 基础菜单
// ==========================================

const menus = [
  {
    code: 'DASHBOARD',
    title: '工作台',
    path: '/dashboard',
    icon: 'LayoutDashboard',
    sortOrder: 1,
  },
  {
    code: 'SYSTEM',
    title: '系统管理',
    path: null,
    icon: 'Settings',
    sortOrder: 100,
  },
] as const

// ==========================================
// 6. Seed 主流程
// ==========================================

async function main() {
  console.log('开始初始化基础数据...')

  // 6.1 创建角色
  const roleRecords = new Map<string, string>()

  for (const role of roles) {
    const record = await prisma.role.upsert({
      where: { code: role.code },
      create: role,
      update: {},
    })

    roleRecords.set(role.code, record.id)
  }

  console.log(`角色初始化完成：${roleRecords.size} 个`)

  // 6.2 创建权限
  const permissionRecords: string[] = []

  for (const permission of permissions) {
    const record = await prisma.permission.upsert({
      where: { code: permission.code },
      create: permission,
      update: {},
    })

    permissionRecords.push(record.id)
  }

  console.log(`权限初始化完成：${permissionRecords.length} 个`)

  // 6.3 创建父级菜单：工作台、系统管理
  const menuRecords = new Map<string, string>()

  for (const menu of menus) {
    const record = await prisma.menu.upsert({
      where: { code: menu.code },
      create: {
        ...menu,
        type: menu.code === 'SYSTEM' ? 'DIRECTORY' : 'PAGE',
      },
      update: {},
    })

    menuRecords.set(menu.code, record.id)
  }

  // 6.4 创建系统管理子菜单：用户管理
  const userMenu = await prisma.menu.upsert({
    where: { code: 'USER_MANAGEMENT' },
    create: {
      code: 'USER_MANAGEMENT',
      title: '用户管理',
      path: '/users',
      icon: 'Users',
      type: 'PAGE',
      parentId: menuRecords.get('SYSTEM')!,
      sortOrder: 1,
    },
    update: {},
  })

  menuRecords.set('USER_MANAGEMENT', userMenu.id)

  console.log(`菜单初始化完成：${menuRecords.size} 个`)

  // 6.5 创建超级管理员
  // 密码只在首次创建时哈希，重复运行不会重置密码。
  const passwordHash = await argon2.hash(adminPassword, {
    type: argon2.argon2id,
  })

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    create: {
      email: adminEmail,
      passwordHash,
      displayName: adminDisplayName,
      status: 'ACTIVE',
    },
    update: {},
  })

  console.log(`超级管理员已就绪：${admin.email}`)

  // 6.6 为超级管理员分配 SUPER_ADMIN 角色
  const superAdminRoleId = roleRecords.get('SUPER_ADMIN')!

  await prisma.userRole.createMany({
    data: [
      {
        userId: admin.id,
        roleId: superAdminRoleId,
        createdById: admin.id,
      },
    ],
    skipDuplicates: true,
  })

  // 6.7 为 SUPER_ADMIN 分配全部初始化权限
  await prisma.rolePermission.createMany({
    data: permissionRecords.map((permissionId) => ({
      roleId: superAdminRoleId,
      permissionId,
      createdById: admin.id,
    })),
    skipDuplicates: true,
  })

  // 6.8 为 SUPER_ADMIN 分配全部初始化菜单
  await prisma.roleMenu.createMany({
    data: [...menuRecords.values()].map((menuId) => ({
      roleId: superAdminRoleId,
      menuId,
      createdById: admin.id,
    })),
    skipDuplicates: true,
  })

  console.log('超级管理员角色、权限、菜单关联完成')
  console.log('Seed 初始化成功！')
}

// ==========================================
// 7. 执行与资源释放
// ==========================================

main()
  .catch((error: unknown) => {
    console.error('Seed 初始化失败：', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
