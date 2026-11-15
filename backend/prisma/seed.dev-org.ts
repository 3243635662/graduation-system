import 'dotenv/config'
import { PrismaMariaDb } from '@prisma/adapter-mariadb'

import { PrismaClient } from '../generated/prisma/client.js'

/**
 * 本地开发用组织演示数据
 *
 * 与 prisma/seed.ts 分离：
 * - 正式 Seed 只维护学校根节点，不写入任何虚构院系；
 * - 本脚本必须显式确认后才执行，只用于本地开发/联调；
 * - 幂等：已存在的节点不覆盖名称与排序，只校验类型和父节点；
 * - 不删除、不停用任何已有组织、用户或角色分配。
 */

if (process.env['DEV_SEED_CONFIRM'] !== 'true') {
  throw new Error(
    '拒绝执行：这是开发演示数据脚本。请显式设置 DEV_SEED_CONFIRM=true 后再运行（pnpm --filter backend seed:dev-org）。',
  )
}

const databaseUrl = process.env['DATABASE_URL']

if (!databaseUrl) {
  throw new Error('缺少 DATABASE_URL 环境变量')
}

interface DevOrgNode {
  code: string
  name: string
  type: 'DEPARTMENT' | 'MAJOR' | 'CLASS'
  parentCode: string
  sortOrder: number
}

/**
 * 演示组织树
 *
 * 示范大学（既有根节点）
 * ├── 计算机学院
 * │   ├── 软件工程
 * │   │   ├── 软件工程一班
 * │   │   └── 软件工程二班
 * │   └── 计算机科学与技术
 * │       └── 计算机一班
 * └── 经济管理学院
 *     └── 工商管理
 *         └── 工商管理一班
 */
const DEV_ORG_TREE: readonly DevOrgNode[] = [
  { code: 'CS', name: '计算机学院', type: 'DEPARTMENT', parentCode: 'SCHOOL-ROOT', sortOrder: 1 },
  { code: 'SE', name: '软件工程', type: 'MAJOR', parentCode: 'CS', sortOrder: 1 },
  { code: 'SE-2401', name: '软件工程一班', type: 'CLASS', parentCode: 'SE', sortOrder: 1 },
  { code: 'SE-2402', name: '软件工程二班', type: 'CLASS', parentCode: 'SE', sortOrder: 2 },
  { code: 'CSE', name: '计算机科学与技术', type: 'MAJOR', parentCode: 'CS', sortOrder: 2 },
  { code: 'CSE-2401', name: '计算机一班', type: 'CLASS', parentCode: 'CSE', sortOrder: 1 },
  {
    code: 'ECON',
    name: '经济管理学院',
    type: 'DEPARTMENT',
    parentCode: 'SCHOOL-ROOT',
    sortOrder: 2,
  },
  { code: 'BA', name: '工商管理', type: 'MAJOR', parentCode: 'ECON', sortOrder: 1 },
  { code: 'BA-2401', name: '工商管理一班', type: 'CLASS', parentCode: 'BA', sortOrder: 1 },
]

const prisma = new PrismaClient({
  adapter: new PrismaMariaDb(databaseUrl),
})

async function main() {
  const root = await prisma.organizationUnit.findFirst({
    where: { type: 'SCHOOL' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, code: true, name: true, status: true },
  })

  if (!root) {
    throw new Error(
      '未找到学校根节点，请先执行正式 Seed（pnpm --filter backend exec prisma db seed）',
    )
  }

  console.log(`学校根节点：${root.name}（${root.code}），状态 ${root.status}`)

  // 同时登记真实编码与占位编码，兼容 SCHOOL_CODE 被改过的环境
  const idByCode = new Map<string, string>([
    [root.code, root.id],
    ['SCHOOL-ROOT', root.id],
  ])

  const summary = await prisma.$transaction(async (tx) => {
    let created = 0
    let existing = 0

    for (const node of DEV_ORG_TREE) {
      const parentId = idByCode.get(node.parentCode)

      if (!parentId) {
        throw new Error(`父节点 ${node.parentCode} 尚未创建，请检查节点顺序`)
      }

      const current = await tx.organizationUnit.findUnique({
        where: { code: node.code },
        select: { id: true, type: true, parentId: true, name: true },
      })

      if (current) {
        // 已存在时只校验结构，不覆盖管理员可能调整过的名称与排序
        if (current.type !== node.type || current.parentId !== parentId) {
          throw new Error(
            `组织编码 ${node.code} 已存在但结构不一致：` +
              `type=${current.type}（期望 ${node.type}），parentId=${current.parentId ?? 'null'}（期望 ${parentId}）。` +
              '为避免破坏现有数据，脚本已中止且未做任何修改。',
          )
        }

        existing += 1
        idByCode.set(node.code, current.id)

        continue
      }

      const record = await tx.organizationUnit.create({
        data: {
          code: node.code,
          name: node.name,
          type: node.type,
          parentId,
          sortOrder: node.sortOrder,
          status: 'ACTIVE',
        },
        select: { id: true },
      })

      created += 1
      idByCode.set(node.code, record.id)
    }

    return { created, existing }
  })

  console.log(`演示组织数据完成：新增 ${summary.created} 个，已存在 ${summary.existing} 个`)
  console.log('未删除或停用任何既有组织、用户与角色分配。')
}

main()
  .catch((error: unknown) => {
    console.error('开发组织 Seed 失败：', error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
