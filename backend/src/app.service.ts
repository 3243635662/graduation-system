import { Injectable } from '@nestjs/common'

import { PrismaService } from './prisma/prisma.service.js'

@Injectable()
export class AppService {
  constructor(private readonly prisma: PrismaService) {}

  getHello(): string {
    return 'Hello World!'
  }

  async checkDatabase() {
    await this.prisma.$queryRaw`SELECT 1`

    return {
      success: true,
      message: 'MySQL 数据库连接成功',
    }
  }
}
