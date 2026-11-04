import { API_PREFIX } from '@graduation/shared'
import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'

import { AppModule } from './app.module.js'

// .env 可选：文件不存在时沿用系统环境变量
try {
  process.loadEnvFile()
} catch {
  // ignore missing .env
}

const corsOrigins = (process.env.CORS_ORIGIN ?? 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

async function bootstrap() {
  const app = await NestFactory.create(AppModule)

  app.setGlobalPrefix(API_PREFIX)
  app.enableCors({ origin: corsOrigins, credentials: true })

  const port = process.env.PORT ?? 3000
  await app.listen(port)

  const logger = new Logger('Bootstrap')
  logger.log(`🚀 Application is running on: http://localhost:${port}`)
  logger.log(`🔗 API URL: http://localhost:${port}/${API_PREFIX}`)
}

await bootstrap()
