import { API_PREFIX } from '@graduation/shared'
import { Logger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'

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

  // 全局 API 前缀
  app.setGlobalPrefix(API_PREFIX)

  // CORS 跨域配置
  app.enableCors({ origin: corsOrigins, credentials: true })

  // Swagger 文档配置
  const swaggerConfig = new DocumentBuilder()
    .setTitle('毕业设计管理系统 API')
    .setDescription('毕业设计全流程管理平台后端接口文档')
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer', // 使用 Bearer Token 认证方案
        bearerFormat: 'JWT', // 格式是 JWT
        description: '请输入 Access Token',
      },
      'access-token', // 认证方案的名称，供其他 Swagger 装饰器引用
    )
    .build()

  // 根据 NestJS Controller 和 DTO 生成 OpenAPI 文档
  const document = SwaggerModule.createDocument(app, swaggerConfig)

  // 注册 Swagger UI，使用全局 API 前缀
  SwaggerModule.setup('docs', app, document, {
    useGlobalPrefix: true,
  })

  // 启动服务
  const port = process.env.PORT ?? 3000
  await app.listen(port)

  const logger = new Logger('Bootstrap')
  logger.log(`🚀 Application is running on: http://localhost:${port}`)
  logger.log(`🔗 API URL: http://localhost:${port}/${API_PREFIX}`)
  logger.log(`📚 Swagger Docs: http://localhost:${port}/${API_PREFIX}/docs`)
}

await bootstrap()
