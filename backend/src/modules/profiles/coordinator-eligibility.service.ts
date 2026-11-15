import { ForbiddenException, Injectable } from '@nestjs/common'

import type { Prisma } from '../../../generated/prisma/client.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import type { EffectiveRoleAssignment } from '../rbac/authorization/permission.service.js'
import { OrganizationService } from '../rbac/organizations/organization.service.js'

export type EligibilityBasis =
  | 'STUDENT_MONITOR'
  | 'CLASS_ASSISTANT'
  | 'HEAD_TEACHER'
  | 'COUNSELOR'
  | 'SCHOOL_OVERRIDE'

export interface CoordinatorEligibilityResult {
  eligible: boolean
  bases: EligibilityBasis[]
  /** 该用户在目标班级的最近资格到期时间，null 表示无固定到期 */
  expiresAt: Date | null
}

type DbClient = Prisma.TransactionClient | PrismaService

interface ClassContext {
  id: string
  parentId: string | null
  type: string
  pathActive: boolean
  bases: Set<EligibilityBasis>
  expiresAt: Date | null
}

const ROLE_CLASS_COORDINATOR = 'CLASS_COORDINATOR'

function minDate(current: Date | null, next: Date | null): Date | null {
  if (!next) return current
  if (!current) return next

  return next.getTime() < current.getTime() ? next : current
}

/**
 * 协管员资格服务
 *
 * 五种资格来源，全部满足时全部返回（不因命中第一个而提前返回）：
 * - STUDENT_MONITOR：本班在籍学生（仅表示可被选择的资格条件，不等于自动成为班长）
 * - CLASS_ASSISTANT：同专业在籍学生（不等于自动成为班助）
 * - HEAD_TEACHER：有效班主任任职
 * - COUNSELOR：有效辅导员分配
 * - SCHOOL_OVERRIDE：学校管理员特殊覆盖
 *
 * 该服务同时用于「分配时校验」与「运行时权限过滤」，
 * 避免只在写入时校验、之后资格失效仍继续授权。
 *
 * 重要：符合资格只代表该用户可以被管理员选择，
 * 正式协管员身份仍必须通过显式创建 CLASS_COORDINATOR UserRole 产生。
 * 系统不会因为学生是班长/班助的候选人就自动授予角色。
 */
@Injectable()
export class CoordinatorEligibilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizationService: OrganizationService,
  ) {}

  async evaluate(
    userId: string,
    classId: string,
    client: DbClient = this.prisma,
  ): Promise<CoordinatorEligibilityResult> {
    const contexts = await this.loadContexts(userId, [classId], client)
    const context = contexts.get(classId)

    if (!context || context.bases.size === 0) {
      return { eligible: false, bases: [], expiresAt: null }
    }

    return {
      eligible: true,
      bases: [...context.bases],
      expiresAt: context.expiresAt,
    }
  }

  async assertEligible(userId: string, classId: string, client: DbClient = this.prisma) {
    const result = await this.evaluate(userId, classId, client)

    if (!result.eligible) {
      throw new ForbiddenException({
        code: 40300,
        data: null,
        message: '目标用户不满足该班级的协管员资格',
      })
    }
  }

  async isAssignmentEffective(
    assignment: EffectiveRoleAssignment,
    client: DbClient = this.prisma,
  ): Promise<boolean> {
    if (assignment.roleCode !== ROLE_CLASS_COORDINATOR) return true
    if (!assignment.scopeOrgUnitId) return false

    return (await this.evaluate(assignment.userId ?? '', assignment.scopeOrgUnitId, client))
      .eligible
  }

  /**
   * 批量过滤有效角色分配（供 PermissionService 使用）
   *
   * 一次性加载用户档案、任职与覆盖授权，避免逐条分配查询。
   */
  async filterAssignments(
    userId: string,
    assignments: EffectiveRoleAssignment[],
    client: DbClient = this.prisma,
  ): Promise<{ assignments: EffectiveRoleAssignment[]; nextExpiry: Date | null }> {
    const coordinatorAssignments = assignments.filter(
      (item) => item.roleCode === ROLE_CLASS_COORDINATOR,
    )

    if (coordinatorAssignments.length === 0) {
      return {
        assignments,
        nextExpiry: this.minValidUntil(assignments),
      }
    }

    const classIds = [
      ...new Set(
        coordinatorAssignments
          .map((item) => item.scopeOrgUnitId)
          .filter((id): id is string => Boolean(id)),
      ),
    ]

    const contexts = await this.loadContexts(userId, classIds, client)

    const effective: EffectiveRoleAssignment[] = []
    let nextExpiry: Date | null = null

    for (const assignment of assignments) {
      if (assignment.roleCode !== ROLE_CLASS_COORDINATOR) {
        effective.push(assignment)
        nextExpiry = minDate(nextExpiry, assignment.validUntil)

        continue
      }

      const context = assignment.scopeOrgUnitId
        ? contexts.get(assignment.scopeOrgUnitId)
        : undefined

      if (!context || context.bases.size === 0) continue

      effective.push(assignment)
      nextExpiry = minDate(nextExpiry, assignment.validUntil)
      nextExpiry = minDate(nextExpiry, context.expiresAt)
    }

    return { assignments: effective, nextExpiry }
  }

  /**
   * 批量计算「在这些协管员分配上仍然具备资格」的「用户:班级」键
   *
   * 用于用户列表的组织可见性过滤与逐条角色有效性判断：
   * 只做一次批量查询，不按用户 N+1。
   * 入参中的分配必须已经通过 UserRole 有效期/撤销/角色启用过滤。
   */
  async filterQualifiedUserIds(
    rows: Array<{ userId: string; classId: string }>,
    client: DbClient = this.prisma,
  ): Promise<Set<string>> {
    const db = client as unknown as Prisma.TransactionClient
    const qualified = new Set<string>()

    if (rows.length === 0) return qualified

    const userIds = [...new Set(rows.map((row) => row.userId))]
    const classIds = [...new Set(rows.map((row) => row.classId))]
    const now = new Date()

    const [users, students, teachers, duties, counselors, overrides, classNodes] =
      await Promise.all([
        db.user.findMany({
          where: { id: { in: userIds }, status: 'ACTIVE', deletedAt: null },
          select: { id: true },
        }),
        db.studentProfile.findMany({
          where: { userId: { in: userIds }, enrollmentStatus: 'ACTIVE' },
          select: { userId: true, classId: true },
        }),
        db.teacherProfile.findMany({
          where: { userId: { in: userIds }, employmentStatus: 'ACTIVE' },
          select: { userId: true },
        }),
        db.teacherClassDuty.findMany({
          where: {
            classId: { in: classIds },
            revokedAt: null,
            validFrom: { lte: now },
            OR: [{ validUntil: null }, { validUntil: { gt: now } }],
            teacher: { userId: { in: userIds }, employmentStatus: 'ACTIVE' },
          },
          select: { classId: true, teacher: { select: { userId: true } } },
        }),
        db.counselorClassAssignment.findMany({
          where: {
            userId: { in: userIds },
            classId: { in: classIds },
            revokedAt: null,
            validFrom: { lte: now },
            OR: [{ validUntil: null }, { validUntil: { gt: now } }],
          },
          select: { userId: true, classId: true },
        }),
        db.coordinatorQualificationOverride.findMany({
          where: {
            userId: { in: userIds },
            classId: { in: classIds },
            revokedAt: null,
            validFrom: { lte: now },
            OR: [{ validUntil: null }, { validUntil: { gt: now } }],
          },
          select: { userId: true, classId: true },
        }),
        db.organizationUnit.findMany({
          where: { id: { in: classIds } },
          select: { id: true, parentId: true, type: true },
        }),
      ])

    const activeUserIds = new Set(users.map((user) => user.id))

    if (activeUserIds.size === 0) return qualified

    const activeClassIds = new Set<string>()

    for (const node of classNodes) {
      if (node.type !== 'CLASS') continue

      if (await this.organizationService.isPathActive(node.id)) {
        activeClassIds.add(node.id)
      }
    }

    const studentByUser = new Map(students.map((item) => [item.userId, item.classId]))
    const teacherUserIds = new Set(teachers.map((item) => item.userId))

    const studentClassIds = [...new Set(students.map((item) => item.classId))]
    const studentClasses = await db.organizationUnit.findMany({
      where: { id: { in: studentClassIds } },
      select: { id: true, parentId: true },
    })
    const majorByStudentClass = new Map(studentClasses.map((item) => [item.id, item.parentId]))
    const classMajor = new Map(classNodes.map((node) => [node.id, node.parentId]))

    const dutyKeys = new Set(duties.map((item) => `${item.teacher.userId}:${item.classId}`))
    const counselorKeys = new Set(counselors.map((item) => `${item.userId}:${item.classId}`))
    const overrideKeys = new Set(overrides.map((item) => `${item.userId}:${item.classId}`))

    for (const row of rows) {
      if (!activeUserIds.has(row.userId)) continue
      if (!activeClassIds.has(row.classId)) continue

      const studentClassId = studentByUser.get(row.userId)

      if (studentClassId) {
        if (studentClassId === row.classId) {
          qualified.add(`${row.userId}:${row.classId}`)

          continue
        }

        if (majorByStudentClass.get(studentClassId) === classMajor.get(row.classId)) {
          qualified.add(`${row.userId}:${row.classId}`)

          continue
        }
      }

      if (teacherUserIds.has(row.userId)) {
        if (dutyKeys.has(`${row.userId}:${row.classId}`)) {
          qualified.add(`${row.userId}:${row.classId}`)

          continue
        }
      }

      if (counselorKeys.has(`${row.userId}:${row.classId}`)) {
        qualified.add(`${row.userId}:${row.classId}`)

        continue
      }

      if (overrideKeys.has(`${row.userId}:${row.classId}`)) {
        qualified.add(`${row.userId}:${row.classId}`)
      }
    }

    return qualified
  }

  private minValidUntil(assignments: EffectiveRoleAssignment[]): Date | null {
    let result: Date | null = null

    for (const assignment of assignments) {
      result = minDate(result, assignment.validUntil)
    }

    return result
  }

  private async loadContexts(
    userId: string,
    classIds: string[],
    client: DbClient,
  ): Promise<Map<string, ClassContext>> {
    const db = client as unknown as Prisma.TransactionClient
    const contexts = new Map<string, ClassContext>()

    const uniqueClassIds = [...new Set(classIds)]

    if (uniqueClassIds.length === 0) return contexts

    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true, deletedAt: true },
    })

    if (!user || user.deletedAt || user.status !== 'ACTIVE') return contexts

    const now = new Date()

    const [studentProfile, teacherProfile, duties, counselors, overrides, classNodes] =
      await Promise.all([
        db.studentProfile.findUnique({
          where: { userId },
          select: { classId: true, enrollmentStatus: true },
        }),
        db.teacherProfile.findUnique({
          where: { userId },
          select: { id: true, employmentStatus: true },
        }),
        db.teacherClassDuty.findMany({
          where: {
            classId: { in: uniqueClassIds },
            revokedAt: null,
            validFrom: { lte: now },
            OR: [{ validUntil: null }, { validUntil: { gt: now } }],
            teacher: { userId, employmentStatus: 'ACTIVE' },
          },
          select: { classId: true, validUntil: true },
        }),
        db.counselorClassAssignment.findMany({
          where: {
            userId,
            classId: { in: uniqueClassIds },
            revokedAt: null,
            validFrom: { lte: now },
            OR: [{ validUntil: null }, { validUntil: { gt: now } }],
          },
          select: { classId: true, validUntil: true },
        }),
        db.coordinatorQualificationOverride.findMany({
          where: {
            userId,
            classId: { in: uniqueClassIds },
            revokedAt: null,
            validFrom: { lte: now },
            OR: [{ validUntil: null }, { validUntil: { gt: now } }],
          },
          select: { classId: true, validUntil: true },
        }),
        db.organizationUnit.findMany({
          where: { id: { in: uniqueClassIds } },
          select: { id: true, parentId: true, type: true, status: true },
        }),
      ])

    const studentMajorByClass =
      studentProfile && studentProfile.enrollmentStatus === 'ACTIVE'
        ? await db.organizationUnit.findUnique({
            where: { id: studentProfile.classId },
            select: { parentId: true },
          })
        : null

    for (const node of classNodes) {
      const pathActive =
        node.type === 'CLASS' && (await this.organizationService.isPathActive(node.id))

      contexts.set(node.id, {
        id: node.id,
        parentId: node.parentId,
        type: node.type,
        pathActive,
        bases: new Set<EligibilityBasis>(),
        expiresAt: null,
      })
    }

    const addBasis = (classId: string, basis: EligibilityBasis, expiresAt: Date | null = null) => {
      const context = contexts.get(classId)

      if (!context || !context.pathActive) return

      context.bases.add(basis)
      context.expiresAt = minDate(context.expiresAt, expiresAt)
    }

    if (studentProfile && studentProfile.enrollmentStatus === 'ACTIVE') {
      if (uniqueClassIds.includes(studentProfile.classId)) {
        addBasis(studentProfile.classId, 'STUDENT_MONITOR')
      }

      const studentMajorId = studentMajorByClass?.parentId ?? null

      if (studentMajorId) {
        for (const node of classNodes) {
          if (node.parentId === studentMajorId && node.id !== studentProfile.classId) {
            addBasis(node.id, 'CLASS_ASSISTANT')
          }
        }
      }
    }

    if (teacherProfile && teacherProfile.employmentStatus === 'ACTIVE') {
      for (const duty of duties) {
        addBasis(duty.classId, 'HEAD_TEACHER', duty.validUntil)
      }
    }

    for (const counselor of counselors) {
      addBasis(counselor.classId, 'COUNSELOR', counselor.validUntil)
    }

    for (const override of overrides) {
      addBasis(override.classId, 'SCHOOL_OVERRIDE', override.validUntil)
    }

    return contexts
  }
}
