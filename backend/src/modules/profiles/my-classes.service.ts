import { Injectable } from '@nestjs/common'

import { PrismaService } from '../../prisma/prisma.service.js'

export type MyClassResponsibilityType = 'COUNSELOR' | 'COORDINATOR_AUTHORIZATION'

/**
 * 个人班级职责查询。
 *
 * 不从人员档案或教师档案推断职责：辅导员只认 CounselorClassAssignment，
 * 班级协管认 CLASS_COORDINATOR 的 UserRole；CoordinatorQualificationOverride 是其
 * 特殊授权来源之一。两种来源可汇总到同一班级，
 * 但始终作为独立关系返回。
 */
@Injectable()
export class MyClassesService {
  constructor(private readonly prisma: PrismaService) {}

  async listForUser(userId: string) {
    const now = new Date()
    const effective = {
      revokedAt: null,
      validFrom: { lte: now },
      OR: [{ validUntil: null }, { validUntil: { gt: now } }],
    }

    const [counselorAssignments, coordinatorOverrides, roleAssignments] = await Promise.all([
      this.prisma.counselorClassAssignment.findMany({
        where: { userId, ...effective },
        select: {
          id: true,
          classId: true,
          validFrom: true,
          validUntil: true,
          class: { select: { id: true, code: true, name: true, status: true } },
        },
      }),
      this.prisma.coordinatorQualificationOverride.findMany({
        where: { userId, ...effective },
        select: {
          id: true,
          classId: true,
          validFrom: true,
          validUntil: true,
          reason: true,
          class: { select: { id: true, code: true, name: true, status: true } },
        },
      }),
      this.prisma.userRole.findMany({
        where: {
          userId,
          validFrom: { lte: now },
          OR: [{ validUntil: null }, { validUntil: { gt: now } }],
          role: { code: 'CLASS_COORDINATOR', status: 'ACTIVE' },
          scopeOrgUnit: { type: 'CLASS', status: 'ACTIVE' },
        },
        select: {
          id: true,
          scopeOrgUnitId: true,
          validFrom: true,
          validUntil: true,
          scopeOrgUnit: { select: { id: true, code: true, name: true, status: true } },
        },
      }),
    ])

    const authorizedClassIds = new Set(
      roleAssignments.flatMap((assignment) =>
        assignment.scopeOrgUnitId ? [assignment.scopeOrgUnitId] : [],
      ),
    )

    const result = new Map<
      string,
      {
        classId: string
        classCode: string
        className: string
        responsibilities: Array<{
          type: MyClassResponsibilityType
          recordId: string
          validFrom: Date
          validUntil: Date | null
          reason?: string
        }>
      }
    >()
    const append = (
      row: (typeof counselorAssignments)[number] | (typeof coordinatorOverrides)[number],
      type: MyClassResponsibilityType,
    ) => {
      if (!authorizedClassIds.has(row.classId) || row.class.status !== 'ACTIVE') return
      const item = result.get(row.classId) ?? {
        classId: row.classId,
        classCode: row.class.code,
        className: row.class.name,
        responsibilities: [],
      }
      item.responsibilities.push({
        type,
        recordId: row.id,
        validFrom: row.validFrom,
        validUntil: row.validUntil,
        ...('reason' in row ? { reason: row.reason } : {}),
      })
      result.set(row.classId, item)
    }

    counselorAssignments.forEach((row) => append(row, 'COUNSELOR'))
    coordinatorOverrides.forEach((row) => append(row, 'COORDINATOR_AUTHORIZATION'))
    for (const assignment of roleAssignments) {
      const classUnit = assignment.scopeOrgUnit
      if (!assignment.scopeOrgUnitId || !classUnit) continue
      // 辅导员分配自动补齐的 UserRole 是授权支撑，不能伪装为第二条职责来源。
      if (counselorAssignments.some((row) => row.classId === assignment.scopeOrgUnitId)) continue
      if (coordinatorOverrides.some((row) => row.classId === assignment.scopeOrgUnitId)) continue
      append(
        {
          id: assignment.id,
          classId: assignment.scopeOrgUnitId,
          validFrom: assignment.validFrom,
          validUntil: assignment.validUntil,
          class: classUnit,
        },
        'COORDINATOR_AUTHORIZATION',
      )
    }

    return [...result.values()].toSorted((a, b) => a.classCode.localeCompare(b.classCode, 'en'))
  }

  async listTeacherDutiesForUser(userId: string) {
    const now = new Date()

    return this.prisma.teacherClassDuty.findMany({
      where: {
        revokedAt: null,
        validFrom: { lte: now },
        OR: [{ validUntil: null }, { validUntil: { gt: now } }],
        teacher: { personnelProfile: { userId } },
      },
      select: {
        id: true,
        dutyType: true,
        validFrom: true,
        validUntil: true,
        class: { select: { id: true, code: true, name: true, status: true } },
      },
      orderBy: { class: { code: 'asc' } },
    })
  }
}
