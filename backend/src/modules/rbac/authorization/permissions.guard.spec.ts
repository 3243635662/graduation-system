import { ForbiddenException, UnauthorizedException } from '@nestjs/common'
import type { ExecutionContext } from '@nestjs/common'
import type { Reflector } from '@nestjs/core'
import { describe, expect, it } from 'vitest'

import type { PermissionService } from './permission.service.js'
import { PermissionsGuard } from './permissions.guard.js'

function createContext(user?: { userId: string; sessionId: string }): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class TestController {},
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext
}

function createGuard(required: string[] | undefined, granted: string[]) {
  const reflector = {
    getAllAndOverride: () => required,
  } as unknown as Reflector

  const permissionService = {
    hasPermission: async (_userId: string, permission: string) => granted.includes(permission),
  } as unknown as PermissionService

  return new PermissionsGuard(reflector, permissionService)
}

describe('PermissionsGuard', () => {
  it('未声明权限的接口直接放行（仅要求登录）', async () => {
    await expect(createGuard(undefined, []).canActivate(createContext())).resolves.toBe(true)
    await expect(createGuard([], []).canActivate(createContext())).resolves.toBe(true)
  })

  it('声明了权限但没有认证上下文时返回 401', async () => {
    await expect(
      createGuard(['rbac:role:read'], []).canActivate(createContext()),
    ).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('没有对应功能权限时返回 403', async () => {
    await expect(
      createGuard(['organization:unit:create'], []).canActivate(
        createContext({ userId: 'user-1', sessionId: 'session-1' }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('拥有所需权限时放行', async () => {
    await expect(
      createGuard(['rbac:role:read'], ['rbac:role:read']).canActivate(
        createContext({ userId: 'user-1', sessionId: 'session-1' }),
      ),
    ).resolves.toBe(true)
  })

  it('多个权限按「与」校验：缺少任意一个即拒绝', async () => {
    await expect(
      createGuard(
        ['organization:unit:read', 'organization:unit:update'],
        ['organization:unit:read'],
      ).canActivate(createContext({ userId: 'user-1', sessionId: 'session-1' })),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })
})
