/**
 * 内存版 Prisma 假实现
 *
 * 只覆盖 Auth 模块使用到的方法，用于在不连接真实数据库的前提下验证完整链路。
 * 注意：真实 Redis 上的验证码链路仍由 email-code 集成测试覆盖。
 */

export interface FakeUser {
  id: string
  email: string
  passwordHash: string
  displayName: string
  status: 'ACTIVE' | 'DISABLED' | 'LOCKED'
  lastLoginAt: Date | null
}

export interface FakeSession {
  id: string
  userId: string
  refreshTokenHash: string
  expiresAt: Date
  revokedAt: Date | null
  lastUsedAt: Date | null
  ipAddress: string | null
  userAgent: string | null
}

export const STUDENT_ROLE = { id: 'role-student', code: 'STUDENT', name: '学生' }

export function createInMemoryPrisma() {
  const users: FakeUser[] = []
  const sessions: FakeSession[] = []
  const userRoles: Array<{ userId: string; roleId: string }> = []
  let sequence = 0

  const nextId = (prefix: string) => `${prefix}-${++sequence}`

  const withRoles = (user: FakeUser) => {
    const roleIds = userRoles.filter((item) => item.userId === user.id).map((item) => item.roleId)

    const roles = roleIds.map((roleId) => (roleId === STUDENT_ROLE.id ? STUDENT_ROLE : undefined))

    return {
      ...user,
      userRoles: roles
        .filter((role): role is typeof STUDENT_ROLE => Boolean(role))
        .map((role) => ({ role })),
    }
  }

  const matchesSession = (session: FakeSession, where: Record<string, unknown>) => {
    const idCondition = where['id']

    if (typeof idCondition === 'string' && session.id !== idCondition) return false

    if (idCondition && typeof idCondition === 'object' && 'in' in idCondition) {
      const ids = (idCondition as { in: string[] }).in

      if (!ids.includes(session.id)) return false
    }

    if (
      typeof where['refreshTokenHash'] === 'string' &&
      session.refreshTokenHash !== where['refreshTokenHash']
    ) {
      return false
    }

    if (where['revokedAt'] === null && session.revokedAt !== null) return false

    return true
  }

  const prisma = {
    // tx 即假实现自身；用 unknown 避免在对象初始化器里自引用 typeof prisma
    $transaction: async (callback: (tx: unknown) => unknown) => callback(prisma),

    user: {
      async findUnique({ where }: { where: { id?: string; email?: string } }) {
        const user = where.email
          ? users.find((item) => item.email === where.email)
          : users.find((item) => item.id === where.id)

        return user ? withRoles(user) : null
      },

      async create({ data }: { data: Omit<FakeUser, 'id' | 'lastLoginAt'> }) {
        const user: FakeUser = {
          id: nextId('user'),
          lastLoginAt: null,
          ...data,
        }

        users.push(user)

        return user
      },

      async update({ where, data }: { where: { id: string }; data: Partial<FakeUser> }) {
        const user = users.find((item) => item.id === where.id)

        if (!user) throw new Error('user not found')

        Object.assign(user, data)

        return user
      },
    },

    role: {
      async findUnique({ where }: { where: { code: string } }) {
        return where.code === STUDENT_ROLE.code ? STUDENT_ROLE : null
      },
    },

    userRole: {
      async create({ data }: { data: { userId: string; roleId: string } }) {
        userRoles.push(data)
        return data
      },
    },

    authSession: {
      async create({ data }: { data: Omit<FakeSession, 'id' | 'revokedAt' | 'lastUsedAt'> }) {
        const session: FakeSession = {
          id: nextId('session'),
          revokedAt: null,
          lastUsedAt: null,
          ...data,
        }

        sessions.push(session)

        return session
      },

      async findUnique({ where }: { where: { id?: string; refreshTokenHash?: string } }) {
        const session = where.id
          ? sessions.find((item) => item.id === where.id)
          : sessions.find((item) => item.refreshTokenHash === where.refreshTokenHash)

        if (!session) return null

        const user = users.find((item) => item.id === session.userId)

        return { ...session, user: user ? withRoles(user) : null }
      },

      async updateMany({
        where,
        data,
      }: {
        where: Record<string, unknown>
        data: Partial<FakeSession>
      }) {
        let count = 0

        for (const session of sessions) {
          if (!matchesSession(session, where)) continue

          Object.assign(session, data)
          count += 1
        }

        return { count }
      },
    },
  }

  return { prisma, users, sessions }
}
