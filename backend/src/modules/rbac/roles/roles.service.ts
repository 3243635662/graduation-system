import { Injectable, NotFoundException } from '@nestjs/common'

import { PrismaService } from '../../../prisma/prisma.service.js'

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 获取系统角色列表
   */
  async findAll() {
    return this.prisma.role.findMany({
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        isSystem: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: {
        code: 'asc',
      },
    })
  }

  /**
   * 根据 ID 获取角色详情
   */
  async findOne(id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        isSystem: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    if (!role) throw new NotFoundException('角色不存在')

    return role
  }
}
