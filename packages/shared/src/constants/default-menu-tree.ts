import type { MenuTreeNode } from '../types/menu.type.js'

/**
 * Phase 1 菜单树 —— 前后端共享的唯一菜单数据源
 *
 * 设计原则：
 * 1. 菜单只登记「后端已经存在真实接口」的入口，不预埋尚未实现的毕业设计业务页面；
 * 2. DIRECTORY 只用于分组，path 与 componentKey 均为 null；PAGE 必须同时具备两者；
 * 3. componentKey 对应前端 src/views 下的页面文件相对路径（不含 .vue）；
 * 4. 侧边栏只渲染两级，因此树深度不超过 2。
 *
 * 角色可见性由 RoleMenu / ROLE_MENU_CODES 决定，不在本文件表达。
 */
export const DEFAULT_MENU_TREE: MenuTreeNode[] = [
  {
    code: 'DASHBOARD',
    title: '工作台',
    path: '/dashboard',
    type: 'PAGE',
    icon: 'LayoutDashboard',
    componentKey: 'dashboard/index',
    sortOrder: 1,
  },
  {
    code: 'IDENTITY',
    title: '用户与人员',
    path: null,
    type: 'DIRECTORY',
    icon: 'Users',
    sortOrder: 10,
    children: [
      {
        code: 'USER_ACCOUNTS',
        title: '账号管理',
        path: '/users',
        type: 'PAGE',
        icon: 'UserCog',
        componentKey: 'users/index',
        sortOrder: 1,
      },
      {
        code: 'STUDENT_PROFILES',
        title: '学生档案',
        path: '/students',
        type: 'PAGE',
        icon: 'GraduationCap',
        componentKey: 'students/index',
        sortOrder: 2,
      },
      {
        code: 'STAFF_PROFILES',
        title: '教职工档案',
        path: '/staff',
        type: 'PAGE',
        icon: 'Contact',
        componentKey: 'staff/index',
        sortOrder: 3,
      },
      {
        code: 'ROLE_ASSIGNMENTS',
        title: '角色授权',
        path: '/role-assignments',
        type: 'PAGE',
        icon: 'ShieldCheck',
        componentKey: 'role-assignments/index',
        sortOrder: 4,
      },
    ],
  },
  {
    code: 'ORGANIZATION',
    title: '组织架构',
    path: null,
    type: 'DIRECTORY',
    icon: 'Network',
    sortOrder: 20,
    children: [
      {
        code: 'ORGANIZATION_TREE',
        title: '学校与院系',
        path: '/organizations',
        type: 'PAGE',
        icon: 'Building2',
        componentKey: 'organizations/index',
        sortOrder: 1,
      },
    ],
  },
  {
    code: 'CLASS_AFFAIRS',
    title: '班级事务',
    path: null,
    type: 'DIRECTORY',
    icon: 'School',
    sortOrder: 30,
    children: [
      {
        code: 'MY_CLASSES',
        title: '我的班级',
        path: '/my-classes',
        type: 'PAGE',
        icon: 'School',
        componentKey: 'my-classes/index',
        sortOrder: 1,
      },
      {
        code: 'MY_CLASS_DUTIES',
        title: '我的班级职责',
        path: '/my-class-duties',
        type: 'PAGE',
        icon: 'UserCheck',
        componentKey: 'my-class-duties/index',
        sortOrder: 2,
      },
      {
        code: 'CLASS_DUTIES',
        title: '班主任任职',
        path: '/class-duties',
        type: 'PAGE',
        icon: 'UserCheck',
        componentKey: 'class-duties/index',
        sortOrder: 3,
      },
      {
        code: 'COUNSELOR_ASSIGNMENTS',
        title: '辅导员分配',
        path: '/counselors',
        type: 'PAGE',
        icon: 'HeartHandshake',
        componentKey: 'counselors/index',
        sortOrder: 4,
      },
      {
        code: 'COORDINATOR_ASSIGNMENTS',
        title: '协管员授权',
        path: '/coordinator-assignments',
        type: 'PAGE',
        icon: 'ClipboardList',
        componentKey: 'coordinator-assignments/index',
        sortOrder: 5,
      },
    ],
  },
  {
    code: 'SYSTEM',
    title: '系统管理',
    path: null,
    type: 'DIRECTORY',
    icon: 'Settings',
    sortOrder: 40,
    children: [
      {
        code: 'AUDIT_LOGS',
        title: '审计日志',
        path: '/audit-logs',
        type: 'PAGE',
        icon: 'ScrollText',
        componentKey: 'audit-logs/index',
        sortOrder: 1,
      },
      {
        code: 'MY_PROFILE',
        title: '个人资料',
        path: '/profile',
        type: 'PAGE',
        icon: 'UserRound',
        componentKey: 'profile/index',
        sortOrder: 2,
      },
    ],
  },
]

/** Phase 1 允许出现在菜单中的页面编码白名单，供 Seed 校验使用 */
export const PHASE1_MENU_PAGE_CODES = [
  'DASHBOARD',
  'USER_ACCOUNTS',
  'STUDENT_PROFILES',
  'STAFF_PROFILES',
  'ROLE_ASSIGNMENTS',
  'ORGANIZATION_TREE',
  'MY_CLASSES',
  'MY_CLASS_DUTIES',
  'CLASS_DUTIES',
  'COUNSELOR_ASSIGNMENTS',
  'COORDINATOR_ASSIGNMENTS',
  'AUDIT_LOGS',
  'MY_PROFILE',
] as const
