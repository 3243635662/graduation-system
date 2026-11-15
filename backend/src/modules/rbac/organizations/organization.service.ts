import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'

import type { OrganizationStatus, OrganizationType } from '../../../../generated/prisma/client.js'
import { PrismaService } from '../../../prisma/prisma.service.js'
import {
  ORGANIZATION_PARENT_TYPE,
  buildOrganizationTree,
  type CreateOrganizationInput,
  type OrganizationTreeNode,
  type UpdateOrganizationInput,
} from './organization.types.js'

const ORGANIZATION_SELECT = {
  id: true,
  name: true,
  code: true,
  type: true,
  status: true,
  sortOrder: true,
  parentId: true,
} as const

/** 组织类型的中文名称，仅用于错误信息 */
const TYPE_LABEL: Record<OrganizationType, string> = {
  SCHOOL: '学校',
  DEPARTMENT: '院系',
  MAJOR: '专业',
  CLASS: '班级',
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  )
}

/**
 * 组织树服务
 *
 * 设计约束：
 * 1. 只使用 parentId 邻接表，不引入闭包表。
 * 2. 层级由 type 决定：SCHOOL → DEPARTMENT → MAJOR → CLASS，禁止跨级或反向挂载。
 * 3. 单学校系统只允许一个 SCHOOL 根节点。
 * 4. 不提供删除能力：停用即可，避免误删仍被角色分配引用的节点。
 * 5. 组织归属不等于角色：本服务不判断任何 RBAC 权限，授权由 Phase 3 的
 *    OrganizationScopeService 基于调用者角色分配完成。
 */
@Injectable()
export class OrganizationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 组织树（默认隐藏停用节点及其子树）
   *
   * allowedIds 用于把调用者的数据范围真正下推到数据库查询：
   * 空数组表示没有任何可见节点，绝不能当成「不过滤」。
   */
  async getTree(includeDisabled = false, allowedIds?: string[]): Promise<OrganizationTreeNode[]> {
    const rows = await this.prisma.organizationUnit.findMany({
      where: allowedIds ? { id: { in: allowedIds } } : undefined,
      select: ORGANIZATION_SELECT,
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    })

    // allowedIds 已裁剪掉范围外的祖先，缺失父节点应视为根节点而不是丢弃子树
    return buildOrganizationTree(rows, includeDisabled, Boolean(allowedIds))
  }

  async findById(id: string): Promise<OrganizationTreeNode> {
    const row = await this.prisma.organizationUnit.findUnique({
      where: { id },
      select: ORGANIZATION_SELECT,
    })

    if (!row) throw new NotFoundException('组织节点不存在')

    return { ...row, children: [] }
  }

  /** 创建组织节点，并校验层级与父节点状态 */
  async create(input: CreateOrganizationInput, actorId: string): Promise<OrganizationTreeNode> {
    const name = input.name.trim()
    const code = input.code.trim()

    if (!name || !code) {
      throw new BadRequestException('组织名称与编码不能为空')
    }

    const expectedParentType = ORGANIZATION_PARENT_TYPE[input.type]
    const parentId = input.parentId ?? null

    if (expectedParentType === null) {
      if (parentId !== null) {
        throw new BadRequestException('学校节点不允许指定父节点')
      }

      const existingSchool = await this.prisma.organizationUnit.findFirst({
        where: { type: 'SCHOOL' },
        select: { id: true },
      })

      if (existingSchool) {
        throw new ConflictException('系统只允许存在一个学校根节点')
      }
    } else {
      if (!parentId) {
        throw new BadRequestException(
          `${TYPE_LABEL[input.type]}必须挂载在${TYPE_LABEL[expectedParentType]}节点下`,
        )
      }

      const parent = await this.prisma.organizationUnit.findUnique({
        where: { id: parentId },
        select: { id: true, type: true, status: true },
      })

      if (!parent) {
        throw new BadRequestException('父组织节点不存在')
      }

      if (parent.type !== expectedParentType) {
        throw new BadRequestException(
          `${TYPE_LABEL[input.type]}的父节点必须是${TYPE_LABEL[expectedParentType]}`,
        )
      }

      if (parent.status !== 'ACTIVE') {
        throw new BadRequestException('父组织节点已停用，不能在其下创建子节点')
      }
    }

    const duplicated = await this.prisma.organizationUnit.findUnique({
      where: { code },
      select: { id: true },
    })

    if (duplicated) {
      throw new ConflictException('组织编码已存在')
    }

    try {
      const created = await this.prisma.organizationUnit.create({
        data: {
          name,
          code,
          type: input.type,
          parentId,
          sortOrder: input.sortOrder ?? 0,
          createdById: actorId,
        },
        select: ORGANIZATION_SELECT,
      })

      return { ...created, children: [] }
    } catch (error) {
      // 并发创建同一个编码时由唯一索引兜底
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('组织编码已存在')
      }

      throw error
    }
  }

  /**
   * 更新组织节点。
   *
   * 只允许修改名称、排序与状态：
   * 变更 type / code / parentId 会破坏既有角色分配的组织范围语义，
   * 需要时应新建节点并迁移分配记录。
   */
  async update(id: string, input: UpdateOrganizationInput): Promise<OrganizationTreeNode> {
    const current = await this.prisma.organizationUnit.findUnique({
      where: { id },
      select: { ...ORGANIZATION_SELECT, parentId: true },
    })

    if (!current) throw new NotFoundException('组织节点不存在')

    const data: { name?: string; sortOrder?: number; status?: 'ACTIVE' | 'DISABLED' } = {}

    if (input.name !== undefined) {
      const name = input.name.trim()

      if (!name) throw new BadRequestException('组织名称不能为空')

      data.name = name
    }

    if (input.sortOrder !== undefined) {
      data.sortOrder = input.sortOrder
    }

    if (input.status !== undefined && input.status !== current.status) {
      if (input.status === 'ACTIVE' && current.parentId) {
        const parent = await this.prisma.organizationUnit.findUnique({
          where: { id: current.parentId },
          select: { status: true },
        })

        if (!parent || parent.status !== 'ACTIVE') {
          throw new BadRequestException('父组织节点已停用，不能启用该节点')
        }
      }

      if (input.status === 'DISABLED' && current.type === 'SCHOOL') {
        const activeSchools = await this.prisma.organizationUnit.count({
          where: { type: 'SCHOOL', status: 'ACTIVE' },
        })

        if (activeSchools <= 1) {
          throw new BadRequestException('系统必须保留一个启用的学校根节点')
        }
      }

      data.status = input.status
    }

    const updated = await this.prisma.organizationUnit.update({
      where: { id },
      data,
      select: ORGANIZATION_SELECT,
    })

    return { ...updated, children: [] }
  }

  /** 祖先 id 列表（由近到远，不含自身） */
  async getAncestorIds(id: string): Promise<string[]> {
    const ancestors: string[] = []
    const seen = new Set<string>([id])

    let cursor: string | null =
      (
        await this.prisma.organizationUnit.findUnique({
          where: { id },
          select: { parentId: true },
        })
      )?.parentId ?? null

    while (cursor) {
      if (seen.has(cursor)) break

      seen.add(cursor)
      ancestors.push(cursor)

      cursor =
        (
          await this.prisma.organizationUnit.findUnique({
            where: { id: cursor },
            select: { parentId: true },
          })
        )?.parentId ?? null
    }

    return ancestors
  }

  /** 后代 id 列表（含自身），用于计算数据范围 */
  /**
   * 授权用组织子树（失败关闭）
   *
   * 规则：
   * 1. 授权根节点自身必须 ACTIVE；
   * 2. 授权根节点的完整祖先链必须 ACTIVE（祖先停用则整条授权失效）；
   * 3. 向下遍历时只进入 ACTIVE 子节点，停用节点及其整棵子树都不产生范围；
   * 4. 不修改任何数据：恢复 ACTIVE 后，未撤销且未过期的分配自动恢复生效。
   *
   * 返回空数组表示该范围当前不产生任何授权。
   */
  async getSubtreeIds(id: string): Promise<string[]> {
    if (!(await this.isPathActive(id))) return []

    const result = new Set<string>([id])
    let frontier = [id]

    while (frontier.length > 0) {
      const rows = await this.prisma.organizationUnit.findMany({
        where: { parentId: { in: frontier }, status: 'ACTIVE' },
        select: { id: true },
      })

      frontier = rows.map((row) => row.id).filter((childId) => !result.has(childId))

      for (const childId of frontier) result.add(childId)
    }

    return [...result]
  }

  /**
   * 管理用组织子树（包含停用后代）
   *
   * 用于「修改/启用」场景：授权根节点与祖先链必须 ACTIVE，
   * 但允许把子树里已停用的节点一并返回，否则停用后将无法再次启用。
   * 读取与业务访问仍然使用 getSubtreeIds（只含 ACTIVE）。
   */
  async getManageableSubtreeIds(id: string): Promise<string[]> {
    if (!(await this.isPathActive(id))) return []

    const result = new Set<string>([id])
    let frontier = [id]

    while (frontier.length > 0) {
      const rows = await this.prisma.organizationUnit.findMany({
        where: { parentId: { in: frontier } },
        select: { id: true, status: true },
      })

      const next: string[] = []

      for (const row of rows) {
        if (result.has(row.id)) continue

        // 停用节点本身纳入管理范围（否则无法重新启用），
        // 但不继续向下展开，避免绕过「停用祖先阻断后代」的规则。
        result.add(row.id)

        if (row.status === 'ACTIVE') next.push(row.id)
      }

      frontier = next
    }

    return [...result]
  }

  /** 节点自身及其完整祖先链是否全部 ACTIVE */
  async isPathActive(id: string): Promise<boolean> {
    const seen = new Set<string>()
    let cursor: string | null = id

    while (cursor) {
      if (seen.has(cursor)) return false

      seen.add(cursor)

      const row: { status: OrganizationStatus; parentId: string | null } | null =
        await this.prisma.organizationUnit.findUnique({
          where: { id: cursor },
          select: { status: true, parentId: true },
        })

      if (!row || row.status !== 'ACTIVE') return false

      cursor = row.parentId
    }

    return true
  }

  /** 目标节点是否落在给定组织范围（含范围根节点）之内 */
  async isWithinScope(targetId: string, scopeRootId: string): Promise<boolean> {
    if (targetId === scopeRootId) return true

    return (await this.getAncestorIds(targetId)).includes(scopeRootId)
  }

  /** 要求节点存在且启用，供角色分配与业务写入前校验 */
  async assertActive(id: string): Promise<void> {
    const row = await this.prisma.organizationUnit.findUnique({
      where: { id },
      select: { status: true },
    })

    if (!row) throw new NotFoundException('组织节点不存在')

    if (row.status !== 'ACTIVE') {
      throw new BadRequestException('组织节点已停用')
    }
  }
}
