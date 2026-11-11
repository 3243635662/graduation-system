import type { Request } from 'express'

/**
 * 获取可信客户端 IP
 *
 * 前提：本项目未开启 Express 的 trust proxy，
 * 因此 request.ip 只来自 TCP 连接本身，不采信可被伪造的 X-Forwarded-For。
 *
 * 如果将来部署在 Nginx / 云负载均衡后面，必须先设置受信代理
 * （app.set('trust proxy', <代理地址>)），再依赖本函数返回的 IP。
 *
 * 返回 null 表示无法识别来源 IP，调用方应跳过 IP 维度限流，
 * 而不是把所有人当成同一个 IP。
 */
export function getClientIp(request: Request): string | null {
  const ip = request.ip?.trim()

  return ip ? ip : null
}
