/**
 * Access Token 内存镜像
 *
 * Access Token 只保存在运行时内存中，不写入 localStorage / sessionStorage。
 * 该模块不依赖任何其他业务模块，供 Pinia Store 写入、请求层同步读取，
 * 从而避免 api-client 与 store 之间的循环依赖。
 *
 * Refresh Token 由后端通过 HttpOnly Cookie 管理，前端无法也不应读取。
 */

let accessToken: string | null = null

export function getAccessToken(): string | null {
  return accessToken
}

export function setAccessToken(token: string | null): void {
  accessToken = token
}
