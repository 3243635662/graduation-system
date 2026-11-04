import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { PrismaMariaDb } from '@prisma/adapter-mariadb'

import { PrismaClient } from '../../generated/prisma/client.js'

function createAdapter() {
  const databaseUrl = process.env['DATABASE_URL']

  if (!databaseUrl) {
    throw new Error('缺少 DATABASE_URL 环境变量')
  }

  return new PrismaMariaDb(databaseUrl)
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      adapter: createAdapter(),
    })
  }

  async onModuleInit() {
    await this.$connect()
  }

  async onModuleDestroy() {
    await this.$disconnect()
  }
}
