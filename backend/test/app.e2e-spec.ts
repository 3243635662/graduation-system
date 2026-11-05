import { API_PREFIX } from '@graduation/shared'
import type { INestApplication } from '@nestjs/common'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { Test } from '@nestjs/testing'
import request from 'supertest'
import type { App } from 'supertest/types.js'

import { configureGlobalEnhancers } from '../src/common/configure-global-enhancers.js'
import { TestController } from './fixtures/test.controller.js'

describe('Global API Infrastructure (e2e)', () => {
  interface TestSwaggerDocument {
    paths: Record<
      string,
      {
        get?: {
          responses: Record<
            string,
            {
              content?: Record<
                string,
                {
                  schema?: unknown
                }
              >
            }
          >
        }
      }
    >
  }

  let app: INestApplication<App>
  let swaggerDocument: TestSwaggerDocument

  const apiUrl = `/${API_PREFIX}/_test`

  beforeAll(async () => {
    // 创建只包含测试 Controller 的测试模块
    const moduleFixture = await Test.createTestingModule({
      controllers: [TestController],
    }).compile()

    app = moduleFixture.createNestApplication()

    // 复用正式项目的全局配置
    app.setGlobalPrefix(API_PREFIX)
    configureGlobalEnhancers(app)

    await app.init()

    // 生成测试环境的 OpenAPI 文档
    swaggerDocument = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Graduation System Test API').setVersion('1.0').build(),
    ) as unknown as TestSwaggerDocument
  })

  afterAll(async () => {
    await app.close()
  })

  describe('统一成功响应', () => {
    it('应该自动包装 Controller 返回的数据', async () => {
      await request(app.getHttpServer())
        .get(`${apiUrl}/success`)
        .expect(200)
        .expect(({ body }) => {
          expect(body).toEqual({
            code: 0,
            data: {
              id: 'test-001',
              name: '测试用户',
            },
            message: '请求成功',
          })
        })
    })
  })

  describe('Zod 分页参数校验', () => {
    it('应该将字符串参数转换为数字', async () => {
      await request(app.getHttpServer())
        .get(`${apiUrl}/pagination?page=2&pageSize=20`)
        .expect(200)
        .expect(({ body }) => {
          expect(body.data).toEqual({
            page: 2,
            pageSize: 20,
          })

          expect(typeof body.data.page).toBe('number')
          expect(typeof body.data.pageSize).toBe('number')
        })
    })

    it('没有传递参数时应该使用默认值', async () => {
      await request(app.getHttpServer())
        .get(`${apiUrl}/pagination`)
        .expect(200)
        .expect(({ body }) => {
          expect(body.data).toEqual({
            page: 1,
            pageSize: 10,
          })
        })
    })

    it('非法分页参数应该返回统一校验错误', async () => {
      await request(app.getHttpServer())
        .get(`${apiUrl}/pagination?page=0&pageSize=200`)
        .expect(400)
        .expect(({ body }) => {
          expect(body.code).toBe(40001)
          expect(body.data).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                path: 'page',
              }),
              expect.objectContaining({
                path: 'pageSize',
              }),
            ]),
          )
          expect(body.message).toBe('请求参数校验失败')
        })
    })
  })

  describe('全局异常过滤器', () => {
    it('应该统一处理 HTTP 400 异常', async () => {
      await request(app.getHttpServer())
        .get(`${apiUrl}/bad-request`)
        .expect(400)
        .expect(({ body }) => {
          expect(body).toEqual({
            code: 40000,
            data: null,
            message: '测试请求错误',
          })
        })
    })

    it('不存在的路由应该返回统一 404 响应', async () => {
      await request(app.getHttpServer())
        .get(`${apiUrl}/not-found`)
        .expect(404)
        .expect(({ body }) => {
          expect(body.code).toBe(40400)
          expect(body.data).toBeNull()
          expect(body.message).toBeDefined()
        })
    })
  })

  describe('Prisma 异常映射', () => {
    it('P2002 唯一约束冲突应该返回 409', async () => {
      await request(app.getHttpServer())
        .get(`${apiUrl}/prisma/p2002`)
        .expect(409)
        .expect(({ body }) => {
          expect(body).toEqual({
            code: 40900,
            data: null,
            message: '数据已存在，不能重复创建',
          })
        })
    })

    it('P2003 外键约束冲突应该返回 409', async () => {
      await request(app.getHttpServer())
        .get(`${apiUrl}/prisma/p2003`)
        .expect(409)
        .expect(({ body }) => {
          expect(body).toEqual({
            code: 40900,
            data: null,
            message: '关联数据不存在或违反关联约束',
          })
        })
    })

    it('P2025 记录不存在应该返回 404', async () => {
      await request(app.getHttpServer())
        .get(`${apiUrl}/prisma/p2025`)
        .expect(404)
        .expect(({ body }) => {
          expect(body).toEqual({
            code: 40400,
            data: null,
            message: '请求的数据不存在',
          })
        })
    })
  })

  describe('Swagger 响应契约', () => {
    /**
     * 根据接口路径和 HTTP 状态码获取响应 Schema
     */
    function getResponseSchema(pathSuffix: string, statusCode: string): Record<string, unknown> {
      const entry = Object.entries(swaggerDocument.paths).find(([path]) =>
        path.endsWith(pathSuffix),
      )

      if (!entry) {
        throw new Error(`Swagger 中未找到接口：${pathSuffix}`)
      }

      const schema = entry[1].get?.responses[statusCode]?.content?.['application/json']?.schema

      if (typeof schema !== 'object' || schema === null) {
        throw new Error(`接口 ${pathSuffix} 的 ${statusCode} 响应缺少 Schema`)
      }

      return schema as Record<string, unknown>
    }

    it('普通成功响应应该包含统一的三个字段', () => {
      const schema = getResponseSchema('/_test/swagger/success', '200')

      expect(schema).toMatchObject({
        type: 'object',
        required: ['code', 'data', 'message'],
        properties: {
          code: {
            type: 'integer',
            enum: [0],
          },
          data: {
            type: 'object',
          },
          message: {
            type: 'string',
          },
        },
      })
    })

    it('错误响应应该正确描述错误码和校验详情', () => {
      const schema = getResponseSchema('/_test/swagger/error', '400')

      expect(schema).toMatchObject({
        type: 'object',
        required: ['code', 'data', 'message'],
        properties: {
          code: {
            type: 'integer',
            enum: [40001],
          },
          data: {
            type: 'array',
            items: {
              type: 'object',
            },
          },
          message: {
            type: 'string',
          },
        },
      })
    })

    it('分页成功响应应该包含 list 和 total', () => {
      const schema = getResponseSchema('/_test/swagger/paginated', '200')

      expect(schema).toMatchObject({
        type: 'object',
        required: ['code', 'data', 'message'],
        properties: {
          code: {
            type: 'integer',
            enum: [0],
          },
          data: {
            type: 'object',
            required: ['list', 'total'],
            properties: {
              list: {
                type: 'array',
                items: {
                  type: 'object',
                },
              },
              total: {
                type: 'integer',
              },
            },
          },
          message: {
            type: 'string',
          },
        },
      })
    })
  })
})
