import { randomUUID } from 'node:crypto'

/**
 * 测试环境准备
 *
 * - 加载 backend/.env（Redis 密码等本地配置）
 * - 覆盖为测试专用值：独立 OTP_PEPPER、独立 Redis Key 前缀
 *
 * 独立前缀保证测试只读写自己的 Key，绝不触碰开发数据。
 */

export const TEST_PEPPER = 'integration-test-pepper-0123456789abcdef'

/** 每次运行唯一，避免不同测试文件/并发运行互相干扰 */
export function createTestKeyPrefix(label: string): string {
  return `test:email-code:${label}:${randomUUID().slice(0, 8)}`
}

export interface TestEnvOptions {
  /** Redis Key 前缀，默认按 label 生成唯一值 */
  keyPrefix?: string
  /** 覆盖验证码配置 */
  overrides?: Record<string, string>
}

/** 加载真实 .env，并写入测试专用环境变量 */
export function setupEmailCodeTestEnv(label: string, options: TestEnvOptions = {}): string {
  try {
    process.loadEnvFile()
  } catch {
    // 没有 .env 时使用系统环境变量（CI 场景）
  }

  const keyPrefix = options.keyPrefix ?? createTestKeyPrefix(label)

  process.env['OTP_PEPPER'] = TEST_PEPPER
  process.env['EMAIL_CODE_TTL_SECONDS'] = '120'
  process.env['EMAIL_CODE_RESEND_INTERVAL_SECONDS'] = '60'
  process.env['EMAIL_CODE_MAX_ATTEMPTS'] = '5'
  process.env['EMAIL_CODE_MAX_SENDS_PER_HOUR'] = '5'
  process.env['EMAIL_CODE_MAX_SENDS_PER_IP_HOUR'] = '20'
  process.env['EMAIL_CODE_KEY_PREFIX'] = keyPrefix

  for (const [key, value] of Object.entries(options.overrides ?? {})) {
    process.env[key] = value
  }

  return keyPrefix
}
