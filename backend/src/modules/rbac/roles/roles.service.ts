import { Injectable, NotFoundException } from '@nestjs/common'

import { PrismaService } from '../../../prisma/prisma.service.js'

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  // 查询角色列表（分页）
  async findAll(page: number, pageSize: number) {
    const skip = (page - 1) * pageSize
    const [list, total] = await Promise.all([
      this.prisma.role.findMany({
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
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
      }),
      this.prisma.role.count(),
    ])
    return { list, total }
  }

  // 查询角色详情
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

  // 查询角色拥有的权限列表
  async findPermissions(id: string) {
    const role = await this.prisma.role.findUnique({ where: { id } })
    if (!role) throw new NotFoundException('角色不存在')

    const rolePermissions = await this.prisma.rolePermission.findMany({
      where: { roleId: id },
      select: {
        permission: {
          select: {
            id: true,
            code: true,
            name: true,
            moduleName: true,
            action: true,
            description: true,
          },
        },
      },
    })

    return rolePermissions.map((rp) => rp.permission)
  }

  // 更新角色权限（全量替换）
  async updatePermissions(id: string, permissionIds: string[]) {
    const role = await this.prisma.role.findUnique({ where: { id } })
    if (!role) throw new NotFoundException('角色不存在')

    // 在事务中先删除旧权限，再插入新权限
    await this.prisma.$transaction([
      this.prisma.rolePermission.deleteMany({ where: { roleId: id } }),
      this.prisma.rolePermission.createMany({
        data: permissionIds.map((permissionId) => ({ roleId: id, permissionId })),
        skipDuplicates: true,
      }),
    ])
  }
}
