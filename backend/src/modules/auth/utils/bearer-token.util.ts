/**
 * 从 Authorization 请求头中提取 Bearer Token。
 *
 * 格式不合法（缺失、非 Bearer、空 Token）时返回 null，由调用方决定如何处理。
 */
export function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null

  const [scheme, token] = header.split(' ')

  if (scheme?.toLowerCase() !== 'bearer' || !token) return null

  return token
}
