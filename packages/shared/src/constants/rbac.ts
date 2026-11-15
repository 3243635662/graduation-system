/**
 * RBAC 预置角色、数据范围、功能权限的唯一数据源
 *
 * 使用约定：
 * 1. 角色是「职责模板」，不是继承层级；管理边界由 UserRole 的组织范围决定。
 * 2. 角色编码、权限编码是稳定标识，Seed、后端守卫、前端展示都引用这里。
 * 3. 本文件只描述系统预置数据，不包含任何运行时授权逻辑。
 * 4. 角色与菜单的关联只维护 PAGE 编码；DIRECTORY 由菜单树自动补齐。
 */

/** 七个预置角色编码 */
export const RoleCode = {
  PLATFORM_SUPER_ADMIN: 'PLATFORM_SUPER_ADMIN',
  SCHOOL_ADMIN: 'SCHOOL_ADMIN',
  DEPARTMENT_ADMIN: 'DEPARTMENT_ADMIN',
  MAJOR_ADMIN: 'MAJOR_ADMIN',
  CLASS_COORDINATOR: 'CLASS_COORDINATOR',
  TEACHER: 'TEACHER',
  STUDENT: 'STUDENT',
} as const

export type RoleCode = (typeof RoleCode)[keyof typeof RoleCode]

/** 旧版超级管理员角色编码，仅用于迁移与审计，不再分配给用户 */
export const LEGACY_SUPER_ADMIN_ROLE_CODE = 'SUPER_ADMIN'

/** 数据范围，与 Prisma 的 DataScope 枚举保持一致 */
export const DataScope = {
  GLOBAL: 'GLOBAL',
  SCHOOL: 'SCHOOL',
  DEPARTMENT: 'DEPARTMENT',
  MAJOR: 'MAJOR',
  CLASS: 'CLASS',
  ASSIGNED: 'ASSIGNED',
  SELF: 'SELF',
} as const

export type DataScope = (typeof DataScope)[keyof typeof DataScope]

/** 功能权限编码：resource:action，菜单可见性与之无关 */
export const PermissionCode = {
  RBAC_ROLE_READ: 'rbac:role:read',
  ORGANIZATION_READ: 'organization:unit:read',
  ORGANIZATION_CREATE: 'organization:unit:create',
  ORGANIZATION_UPDATE: 'organization:unit:update',
  ROLE_ASSIGNMENT_READ: 'rbac:role-assignment:read',
  ROLE_ASSIGNMENT_ASSIGN: 'rbac:role-assignment:assign',
  ROLE_ASSIGNMENT_REVOKE: 'rbac:role-assignment:revoke',

  // Phase E：组织与人员管理
  USER_READ: 'user:read',

  STUDENT_PROFILE_READ: 'student:profile:read',
  STUDENT_PROFILE_CREATE: 'student:profile:create',
  STUDENT_PROFILE_UPDATE: 'student:profile:update',
  STUDENT_PROFILE_TRANSFER: 'student:profile:transfer',
  STUDENT_PROFILE_STATUS_UPDATE: 'student:profile:status:update',

  TEACHER_PROFILE_READ: 'teacher:profile:read',
  TEACHER_PROFILE_CREATE: 'teacher:profile:create',
  TEACHER_PROFILE_UPDATE: 'teacher:profile:update',
  TEACHER_PROFILE_DEPARTMENT_UPDATE: 'teacher:profile:department:update',
  TEACHER_PROFILE_STATUS_UPDATE: 'teacher:profile:status:update',

  CLASS_DUTY_READ: 'organization:class-duty:read',
  CLASS_DUTY_ASSIGN: 'organization:class-duty:assign',
  CLASS_DUTY_REVOKE: 'organization:class-duty:revoke',

  COUNSELOR_READ: 'organization:counselor:read',
  COUNSELOR_ASSIGN: 'organization:counselor:assign',
  COUNSELOR_REVOKE: 'organization:counselor:revoke',

  COORDINATOR_OVERRIDE_READ: 'coordinator:override:read',
  COORDINATOR_OVERRIDE_GRANT: 'coordinator:override:grant',
  COORDINATOR_OVERRIDE_REVOKE: 'coordinator:override:revoke',
} as const

export type PermissionCode = (typeof PermissionCode)[keyof typeof PermissionCode]

export interface RoleDefinition {
  code: RoleCode
  name: string
  description: string
  dataScope: DataScope
}

/** 七个预置角色：职责不同、彼此平级，不存在继承关系 */
export const PRESET_ROLES: readonly RoleDefinition[] = [
  {
    code: RoleCode.PLATFORM_SUPER_ADMIN,
    name: '平台超级管理员',
    description: '系统初始化、技术维护与全局配置，不承担学校日常业务',
    dataScope: DataScope.GLOBAL,
  },
  {
    code: RoleCode.SCHOOL_ADMIN,
    name: '学校管理员',
    description: '全校组织架构、用户与毕业设计业务管理',
    dataScope: DataScope.SCHOOL,
  },
  {
    code: RoleCode.DEPARTMENT_ADMIN,
    name: '院系管理员',
    description: '指定院系及其下级组织的管理',
    dataScope: DataScope.DEPARTMENT,
  },
  {
    code: RoleCode.MAJOR_ADMIN,
    name: '专业管理员',
    description: '指定专业及其下级班级的管理',
    dataScope: DataScope.MAJOR,
  },
  {
    code: RoleCode.CLASS_COORDINATOR,
    name: '班级事务协管员',
    description: '协助指定班级的日常事务与毕业设计进度跟进',
    dataScope: DataScope.CLASS,
  },
  {
    code: RoleCode.TEACHER,
    name: '教师',
    description: '指导、评审分配给自己的学生与项目',
    dataScope: DataScope.ASSIGNED,
  },
  {
    code: RoleCode.STUDENT,
    name: '学生',
    description: '本人选题、毕业设计与论文提交等个人业务',
    dataScope: DataScope.SELF,
  },
] as const

export interface PermissionDefinition {
  code: PermissionCode
  name: string
  moduleName: string
  action: string
  description: string
}

/**
 * 预置功能权限
 *
 * 只登记当前系统真实存在（或本次重构中即将落地）的接口能力，
 * 不为不存在的业务预埋权限编码。
 */
export const PRESET_PERMISSIONS: readonly PermissionDefinition[] = [
  {
    code: PermissionCode.RBAC_ROLE_READ,
    name: '查看角色列表与详情',
    moduleName: 'rbac',
    action: 'role:read',
    description: '读取系统预置角色模板，用于角色分配界面',
  },
  {
    code: PermissionCode.ORGANIZATION_READ,
    name: '查看组织树',
    moduleName: 'organization',
    action: 'unit:read',
    description: '查看组织节点及其层级结构',
  },
  {
    code: PermissionCode.ORGANIZATION_CREATE,
    name: '创建组织节点',
    moduleName: 'organization',
    action: 'unit:create',
    description: '在授权范围内创建院系、专业或班级',
  },
  {
    code: PermissionCode.ORGANIZATION_UPDATE,
    name: '修改组织节点',
    moduleName: 'organization',
    action: 'unit:update',
    description: '修改授权范围内组织节点的名称、排序与状态',
  },
  {
    code: PermissionCode.ROLE_ASSIGNMENT_READ,
    name: '查看角色分配',
    moduleName: 'rbac',
    action: 'role-assignment:read',
    description: '查看授权范围内的用户角色分配与历史记录',
  },
  {
    code: PermissionCode.ROLE_ASSIGNMENT_ASSIGN,
    name: '分配角色',
    moduleName: 'rbac',
    action: 'role-assignment:assign',
    description: '在授权范围内为用户分配角色',
  },
  {
    code: PermissionCode.ROLE_ASSIGNMENT_REVOKE,
    name: '撤销角色',
    moduleName: 'rbac',
    action: 'role-assignment:revoke',
    description: '撤销授权范围内的用户角色分配并保留历史',
  },
  {
    code: PermissionCode.USER_READ,
    name: '查看用户账号',
    moduleName: 'user',
    action: 'read',
    description: '在授权组织范围内分页查询用户账号与详情',
  },
  {
    code: PermissionCode.STUDENT_PROFILE_READ,
    name: '查看学生档案',
    moduleName: 'student',
    action: 'profile:read',
    description: '查询授权班级范围内的学生档案（含未注册账号的档案）',
  },
  {
    code: PermissionCode.STUDENT_PROFILE_CREATE,
    name: '创建学生档案',
    moduleName: 'student',
    action: 'profile:create',
    description: '在授权班级内创建尚未绑定账号的学生档案',
  },
  {
    code: PermissionCode.STUDENT_PROFILE_UPDATE,
    name: '修改学生档案',
    moduleName: 'student',
    action: 'profile:update',
    description: '修改学生姓名等基础信息，不包含转班与学籍状态',
  },
  {
    code: PermissionCode.STUDENT_PROFILE_TRANSFER,
    name: '学生转班',
    moduleName: 'student',
    action: 'profile:transfer',
    description: '在授权范围内将学生转入目标班级并保留转班历史',
  },
  {
    code: PermissionCode.STUDENT_PROFILE_STATUS_UPDATE,
    name: '修改学籍状态',
    moduleName: 'student',
    action: 'profile:status:update',
    description: '修改学生休学、毕业、退学等学籍状态',
  },
  {
    code: PermissionCode.TEACHER_PROFILE_READ,
    name: '查看教师档案',
    moduleName: 'teacher',
    action: 'profile:read',
    description: '查询授权院系范围内的教师档案',
  },
  {
    code: PermissionCode.TEACHER_PROFILE_CREATE,
    name: '创建教师档案',
    moduleName: 'teacher',
    action: 'profile:create',
    description: '为已存在的用户创建教师档案',
  },
  {
    code: PermissionCode.TEACHER_PROFILE_UPDATE,
    name: '修改教师档案',
    moduleName: 'teacher',
    action: 'profile:update',
    description: '历史兼容权限，Phase E4 起由院系/状态两个细分权限替代',
  },
  {
    code: PermissionCode.TEACHER_PROFILE_DEPARTMENT_UPDATE,
    name: '调整教师所属院系',
    moduleName: 'teacher',
    action: 'profile:department:update',
    description: '仅学校管理员可调整教师主要所属院系',
  },
  {
    code: PermissionCode.TEACHER_PROFILE_STATUS_UPDATE,
    name: '修改教师在职状态',
    moduleName: 'teacher',
    action: 'profile:status:update',
    description: '修改教师在职、请假、离职状态并重算协管资格',
  },
  {
    code: PermissionCode.CLASS_DUTY_READ,
    name: '查看班主任任职',
    moduleName: 'organization',
    action: 'class-duty:read',
    description: '查询授权班级范围内的班主任任职与历史',
  },
  {
    code: PermissionCode.CLASS_DUTY_ASSIGN,
    name: '创建班主任任职',
    moduleName: 'organization',
    action: 'class-duty:assign',
    description: '为在职教师创建班主任任职',
  },
  {
    code: PermissionCode.CLASS_DUTY_REVOKE,
    name: '撤销班主任任职',
    moduleName: 'organization',
    action: 'class-duty:revoke',
    description: '撤销班主任任职并重算协管员资格',
  },
  {
    code: PermissionCode.COUNSELOR_READ,
    name: '查看辅导员分配',
    moduleName: 'organization',
    action: 'counselor:read',
    description: '查询授权班级范围内的辅导员分配与历史',
  },
  {
    code: PermissionCode.COUNSELOR_ASSIGN,
    name: '创建辅导员分配',
    moduleName: 'organization',
    action: 'counselor:assign',
    description: '为辅导员账号创建班级分配',
  },
  {
    code: PermissionCode.COUNSELOR_REVOKE,
    name: '撤销辅导员分配',
    moduleName: 'organization',
    action: 'counselor:revoke',
    description: '撤销辅导员分配并重算协管员资格',
  },
  {
    code: PermissionCode.COORDINATOR_OVERRIDE_READ,
    name: '查看特殊覆盖授权',
    moduleName: 'coordinator',
    action: 'override:read',
    description: '查询协管员资格特殊覆盖授权历史',
  },
  {
    code: PermissionCode.COORDINATOR_OVERRIDE_GRANT,
    name: '创建特殊覆盖授权',
    moduleName: 'coordinator',
    action: 'override:grant',
    description: '仅学校管理员可对指定人员在指定班级授予协管员资格',
  },
  {
    code: PermissionCode.COORDINATOR_OVERRIDE_REVOKE,
    name: '撤销特殊覆盖授权',
    moduleName: 'coordinator',
    action: 'override:revoke',
    description: '撤销特殊覆盖授权并重算资格',
  },
] as const

/**
 * 角色 → 默认菜单（只写 PAGE 编码）
 *
 * 授权原则：菜单只决定入口可见性，不代表任何 API 或数据范围授权。
 */
export const ROLE_MENU_CODES: Readonly<Record<RoleCode, readonly string[]>> = {
  PLATFORM_SUPER_ADMIN: ['DASHBOARD', 'AI_ASSISTANT', 'ROLE_MANAGEMENT', 'MENU_MANAGEMENT'],
  SCHOOL_ADMIN: [
    'DASHBOARD',
    'TOPIC_CENTER',
    'TOPIC_REVIEW',
    'PROCESS_REVIEW',
    'PROCESS_MONITOR',
    'DEFENSE_MANAGEMENT',
    'GRADE_MANAGEMENT',
    'ACHIEVEMENT_ARCHIVE',
    'AI_ASSISTANT',
    'USER_MANAGEMENT',
    'DEPARTMENT_MANAGEMENT',
    'MAJOR_MANAGEMENT',
    'ROLE_MANAGEMENT',
  ],
  DEPARTMENT_ADMIN: [
    'DASHBOARD',
    'TOPIC_CENTER',
    'TOPIC_REVIEW',
    'PROCESS_REVIEW',
    'PROCESS_MONITOR',
    'DEFENSE_MANAGEMENT',
    'GRADE_MANAGEMENT',
    'ACHIEVEMENT_ARCHIVE',
    'AI_ASSISTANT',
    'USER_MANAGEMENT',
    'MAJOR_MANAGEMENT',
  ],
  MAJOR_ADMIN: [
    'DASHBOARD',
    'TOPIC_CENTER',
    'TOPIC_REVIEW',
    'PROCESS_REVIEW',
    'PROCESS_MONITOR',
    'DEFENSE_MANAGEMENT',
    'GRADE_MANAGEMENT',
    'ACHIEVEMENT_ARCHIVE',
    'AI_ASSISTANT',
    'USER_MANAGEMENT',
  ],
  CLASS_COORDINATOR: ['DASHBOARD', 'PROCESS_MONITOR', 'AI_ASSISTANT'],
  TEACHER: [
    'DASHBOARD',
    'TOPIC_CENTER',
    'GUIDANCE_STUDENTS',
    'PROCESS_REVIEW',
    'THESIS_REVIEW',
    'DEFENSE_MANAGEMENT',
    'AI_ASSISTANT',
  ],
  STUDENT: [
    'DASHBOARD',
    'TOPIC_CENTER',
    'MY_TOPIC',
    'MY_PROJECT',
    'THESIS_SUBMISSION',
    'AI_ASSISTANT',
  ],
} as const

/**
 * 角色 → 功能权限
 *
 * CLASS_COORDINATOR / TEACHER / STUDENT 当前没有可授予的接口能力：
 * 它们的数据权限依赖尚未实现的班级/指导关系接口，Phase 3 起随接口逐步追加。
 */
export const ROLE_PERMISSION_CODES: Readonly<Record<RoleCode, readonly PermissionCode[]>> = {
  // 平台超管承担系统级维护：可查看组织树、维护角色分配，
  // 但不获得任何学校业务（毕设/论文/成绩）权限。
  PLATFORM_SUPER_ADMIN: [
    PermissionCode.RBAC_ROLE_READ,
    PermissionCode.ORGANIZATION_READ,
    PermissionCode.ROLE_ASSIGNMENT_READ,
    PermissionCode.ROLE_ASSIGNMENT_ASSIGN,
    PermissionCode.ROLE_ASSIGNMENT_REVOKE,
  ],
  SCHOOL_ADMIN: [
    PermissionCode.RBAC_ROLE_READ,
    PermissionCode.ORGANIZATION_READ,
    PermissionCode.ORGANIZATION_CREATE,
    PermissionCode.ORGANIZATION_UPDATE,
    PermissionCode.ROLE_ASSIGNMENT_READ,
    PermissionCode.ROLE_ASSIGNMENT_ASSIGN,
    PermissionCode.ROLE_ASSIGNMENT_REVOKE,
    PermissionCode.USER_READ,
    PermissionCode.STUDENT_PROFILE_READ,
    PermissionCode.STUDENT_PROFILE_CREATE,
    PermissionCode.STUDENT_PROFILE_UPDATE,
    PermissionCode.STUDENT_PROFILE_TRANSFER,
    PermissionCode.STUDENT_PROFILE_STATUS_UPDATE,
    PermissionCode.TEACHER_PROFILE_READ,
    PermissionCode.TEACHER_PROFILE_CREATE,
    PermissionCode.TEACHER_PROFILE_UPDATE,
    PermissionCode.TEACHER_PROFILE_DEPARTMENT_UPDATE,
    PermissionCode.TEACHER_PROFILE_STATUS_UPDATE,
    PermissionCode.CLASS_DUTY_READ,
    PermissionCode.CLASS_DUTY_ASSIGN,
    PermissionCode.CLASS_DUTY_REVOKE,
    PermissionCode.COUNSELOR_READ,
    PermissionCode.COUNSELOR_ASSIGN,
    PermissionCode.COUNSELOR_REVOKE,
    PermissionCode.COORDINATOR_OVERRIDE_READ,
    PermissionCode.COORDINATOR_OVERRIDE_GRANT,
    PermissionCode.COORDINATOR_OVERRIDE_REVOKE,
  ],
  DEPARTMENT_ADMIN: [
    PermissionCode.RBAC_ROLE_READ,
    PermissionCode.ORGANIZATION_READ,
    PermissionCode.ORGANIZATION_CREATE,
    PermissionCode.ORGANIZATION_UPDATE,
    PermissionCode.ROLE_ASSIGNMENT_READ,
    PermissionCode.ROLE_ASSIGNMENT_ASSIGN,
    PermissionCode.ROLE_ASSIGNMENT_REVOKE,
    PermissionCode.USER_READ,
    PermissionCode.STUDENT_PROFILE_READ,
    PermissionCode.STUDENT_PROFILE_CREATE,
    PermissionCode.STUDENT_PROFILE_UPDATE,
    PermissionCode.STUDENT_PROFILE_TRANSFER,
    PermissionCode.STUDENT_PROFILE_STATUS_UPDATE,
    PermissionCode.TEACHER_PROFILE_READ,
    PermissionCode.TEACHER_PROFILE_CREATE,
    PermissionCode.TEACHER_PROFILE_UPDATE,
    PermissionCode.TEACHER_PROFILE_STATUS_UPDATE,
    PermissionCode.CLASS_DUTY_READ,
    PermissionCode.CLASS_DUTY_ASSIGN,
    PermissionCode.CLASS_DUTY_REVOKE,
    PermissionCode.COUNSELOR_READ,
    PermissionCode.COUNSELOR_ASSIGN,
    PermissionCode.COUNSELOR_REVOKE,
  ],
  MAJOR_ADMIN: [
    PermissionCode.RBAC_ROLE_READ,
    PermissionCode.ORGANIZATION_READ,
    PermissionCode.ORGANIZATION_CREATE,
    PermissionCode.ORGANIZATION_UPDATE,
    PermissionCode.ROLE_ASSIGNMENT_READ,
    PermissionCode.ROLE_ASSIGNMENT_ASSIGN,
    PermissionCode.ROLE_ASSIGNMENT_REVOKE,
    PermissionCode.USER_READ,
    PermissionCode.STUDENT_PROFILE_READ,
    PermissionCode.STUDENT_PROFILE_CREATE,
    PermissionCode.STUDENT_PROFILE_UPDATE,
    PermissionCode.STUDENT_PROFILE_TRANSFER,
  ],
  CLASS_COORDINATOR: [],
  TEACHER: [],
  STUDENT: [],
} as const
