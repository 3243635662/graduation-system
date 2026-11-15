import type { AuditJsonValue } from '@graduation/shared'

import { AuditRecordError } from './audit.errors.js'

/**
 * 审计快照安全校验
 *
 * 审计 before/after 只用于表达「最小必要」的业务变更：
 * - 禁止密码、Token、验证码、Cookie、密钥等凭据；
 * - 禁止论文/材料正文、文件内容、AI 私人对话正文；
 * - 禁止类实例（如 Prisma 实体、Date、Buffer），只接受纯 JSON 值。
 *
 * 违规不是静默丢弃，而是抛出异常让业务事务回滚，
 * 避免审计记录与真实业务状态不一致。
 */

/** 根对象为第 1 层，最多 3 层（before.classId / before.meta.from 这类结构足够） */
const MAX_DEPTH = 3
const MAX_KEYS_PER_OBJECT = 40
const MAX_ARRAY_ITEMS = 50
const MAX_STRING_LENGTH = 500
const MAX_KEY_LENGTH = 64

/**
 * 敏感字段名（已去掉分隔符并转小写）
 *
 * 同时覆盖 snake_case / camelCase / kebab-case 写法。
 */
const SENSITIVE_KEYS = new Set([
  // 凭据
  'password',
  'passwd',
  'passwordhash',
  'oldpassword',
  'newpassword',
  'salt',
  'passwordsalt',
  'token',
  'accesstoken',
  'refreshtoken',
  'refreshtokenhash',
  'idtoken',
  'downloadticket',
  'cookie',
  'setcookie',
  'authorization',
  'credential',
  'credentials',
  'apikey',
  'privatekey',
  'secret',
  'clientsecret',
  // 验证码
  'otp',
  'otpcode',
  'otpsecret',
  'verificationcode',
  'verifycode',
  'registercode',
  'emailcode',
  'captcha',
  // 正文与文件内容
  'content',
  'body',
  'rawbody',
  'text',
  'rawtext',
  'richtext',
  'filecontent',
  'filebody',
  'filebuffer',
  'buffer',
  'stream',
  'base64',
  'dataurl',
  'thesiscontent',
  'papercontent',
  'essaycontent',
  'fulltext',
  // AI 私人对话
  'conversation',
  'messages',
  'prompt',
  'prompttext',
  'aiconversation',
  'chatcontent',
  'chatmessages',
  // 身份证件
  'idcard',
  'idcardno',
  'idnumber',
])

function normalizeKey(key: string): string {
  return key.replace(/[\s_-]/g, '').toLowerCase()
}

function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value)

  return prototype === Object.prototype || prototype === null
}

function fail(path: string, reason: string): never {
  throw new AuditRecordError(`审计快照字段 ${path} 不允许写入：${reason}`)
}

/**
 * 校验并复制审计快照
 *
 * 返回全新对象，调用方后续修改原对象不会影响已写入的数据。
 */
export function sanitizeAuditPayload(value: unknown, path = 'before'): AuditJsonValue {
  return sanitizeValue(value, path, 1)
}

function sanitizeValue(value: unknown, path: string, depth: number): AuditJsonValue {
  if (value === null) return null

  switch (typeof value) {
    case 'string':
      if (value.length > MAX_STRING_LENGTH) {
        fail(path, `字符串超过 ${MAX_STRING_LENGTH} 字符，疑似正文内容`)
      }

      return value

    case 'number':
      if (!Number.isFinite(value)) fail(path, '不是有限数值')

      return value

    case 'boolean':
      return value

    case 'undefined':
      fail(path, '值为 undefined')

      break

    case 'object':
      break

    default:
      fail(path, `不支持的原始类型 ${typeof value}`)
  }

  if (depth > MAX_DEPTH) fail(path, `嵌套超过 ${MAX_DEPTH} 层`)

  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_ITEMS) {
      fail(path, `数组元素超过 ${MAX_ARRAY_ITEMS} 个`)
    }

    return value.map((item, index) => sanitizeValue(item, `${path}[${index}]`, depth + 1))
  }

  if (!isPlainObject(value)) {
    fail(path, '只允许纯 JSON 对象，禁止传入类实例、Date、Buffer 等')
  }

  const entries = Object.entries(value as Record<string, unknown>)

  if (entries.length > MAX_KEYS_PER_OBJECT) {
    fail(path, `字段数量超过 ${MAX_KEYS_PER_OBJECT} 个`)
  }

  const result: Record<string, AuditJsonValue> = {}

  for (const [key, item] of entries) {
    if (key.length > MAX_KEY_LENGTH) fail(`${path}.${key}`, '字段名过长')

    if (SENSITIVE_KEYS.has(normalizeKey(key))) {
      fail(`${path}.${key}`, '属于禁止记录的敏感字段')
    }

    result[key] = sanitizeValue(item, `${path}.${key}`, depth + 1)
  }

  return result
}
