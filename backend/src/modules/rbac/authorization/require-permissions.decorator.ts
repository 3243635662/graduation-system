import type { PermissionCode } from '@graduation/shared'
import { SetMetadata } from '@nestjs/common'

/** 权限元数据 Key */
export const REQUIRED_PERMISSIONS_KEY = 'rbac:required-permissions'

/**
 * 声明接口需要的功能权限（多个时按「与」处理）
 *
 * 只声明权限是不够的：Guard 必须真正执行校验，
 * 且业务查询还要按数据范围过滤，菜单隐藏不能作为安全措施。
 */
export const RequirePermissions = (...permissions: PermissionCode[]) =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions)
