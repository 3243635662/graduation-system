import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'

import type { OrganizationType } from '../../../generated/prisma/client.js'
import type { PrismaService } from '../../prisma/prisma.service.js'
import type { OrganizationService } from '../rbac/organizations/organization.service.js'

/** Prisma 唯一约束冲突 */
export function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  )
}

/**
 * 校验档案关联的组织节点
 *
 * 1. 节点必须存在；
 * 2. 类型必须匹配（专业/班级/院系不能混用）；
 * 3. 节点自身及其完整祖先链必须 ACTIVE —— 停用的院系/专业下不允许建立新档案与任职。
 */
export async function assertOrganizationNode(
  organizationService: OrganizationService,
  orgUnitId: string,
  expectedType: OrganizationType,
  label: string,
): Promise<void> {
  const unit = await organizationService.findById(orgUnitId)

  if (unit.type !== expectedType) {
    throw new BadRequestException(`${label}必须是 ${expectedType} 类型的组织节点`)
  }

  if (!(await organizationService.isPathActive(orgUnitId))) {
    throw new BadRequestException(`${label}或其上级组织已停用，不能建立关联`)
  }
}

/** 校验目标用户存在、未删除且处于可用状态 */
export async function assertUsableUser(
  prisma: PrismaService,
  userId: string,
  label = '用户',
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, status: true, deletedAt: true },
  })

  if (!user || user.deletedAt) {
    throw new NotFoundException(`${label}不存在`)
  }

  if (user.status !== 'ACTIVE') {
    throw new BadRequestException(`${label}已被禁用，不能建立关联`)
  }
}

/** 任职有效期校验：结束时间必须晚于开始时间 */
export function assertValidWindow(
  validFrom: Date | undefined,
  validUntil: Date | null | undefined,
) {
  if (validFrom && validUntil && validUntil.getTime() <= validFrom.getTime()) {
    throw new BadRequestException('任职结束时间必须晚于开始时间')
  }
}

export function conflict(message: string): ConflictException {
  return new ConflictException(message)
}
