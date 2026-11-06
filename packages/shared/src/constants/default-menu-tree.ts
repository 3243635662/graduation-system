import type { MenuTreeNode } from '../types/menu.type.js'

/**
 * V1 默认菜单树 —— 前后端共享的唯一菜单数据源
 *
 * 用途：
 * - 前端：生成动态路由与侧边栏（本地兜底，后续可被 /menus/me 覆盖）
 * - 后端：Seed 初始化 menus 表（25 条记录：5 个根节点 + 6 个目录 + 19 个页面）
 *
 * 约定：
 * 1. DIRECTORY 只用于分组，path 与 componentKey 均为 null。
 * 2. PAGE 必须同时具备 path 与 componentKey，componentKey 对应前端 src/views 下的页面文件。
 * 3. 角色与菜单的关联不在本文件维护，由 RoleMenu 表负责。
 *
 * 角色可见性约定（V1）：
 * - 工作台 / 选题管理 / 过程管理 / 论文与答辩 / AI 助手：五种角色均可访问（子页面按角色细分）
 * - 用户管理：超管、校管理员、院系管理员
 * - 院系管理：超管、校管理员
 * - 专业管理：超管、校管理员、院系管理员
 * - 角色管理：超管、校管理员
 * - 菜单管理：仅超管
 */
export const DEFAULT_MENU_TREE: MenuTreeNode[] = [
  {
    // 工作台：不同角色的工作统计、待办与进度
    code: 'DASHBOARD',
    title: '工作台',
    path: '/dashboard',
    type: 'PAGE',
    icon: 'LayoutDashboard',
    componentKey: 'dashboard/index',
    sortOrder: 1,
  },
  {
    // 毕业设计管理：业务核心模块，纯目录节点
    code: 'GRADUATION',
    title: '毕业设计管理',
    path: null,
    type: 'DIRECTORY',
    icon: 'GraduationCap',
    sortOrder: 10,
    children: [
      {
        // 选题管理目录
        code: 'TOPIC_MANAGEMENT',
        title: '选题管理',
        path: null,
        type: 'DIRECTORY',
        icon: 'Lightbulb',
        sortOrder: 1,
        children: [
          {
            // 课题中心：浏览课题、搜索、查看课题信息（全角色）
            code: 'TOPIC_CENTER',
            title: '课题中心',
            path: '/topics',
            type: 'PAGE',
            icon: 'BookOpen',
            componentKey: 'topics/index',
            sortOrder: 1,
          },
          {
            // 我的选题：学生申请、选题状态、选题结果（学生）
            code: 'MY_TOPIC',
            title: '我的选题',
            path: '/topics/my',
            type: 'PAGE',
            icon: 'Bookmark',
            componentKey: 'topics/my',
            sortOrder: 2,
          },
          {
            // 选题审核：院系审核课题、选题申请（院系/学校/超管）
            code: 'TOPIC_REVIEW',
            title: '选题审核',
            path: '/topics/review',
            type: 'PAGE',
            icon: 'ClipboardCheck',
            componentKey: 'topics/review',
            sortOrder: 3,
          },
        ],
      },
      {
        // 过程管理目录
        code: 'PROCESS_MANAGEMENT',
        title: '过程管理',
        path: null,
        type: 'DIRECTORY',
        icon: 'Activity',
        sortOrder: 2,
        children: [
          {
            // 我的毕设：学生个人项目、任务、阶段进度（学生）
            code: 'MY_PROJECT',
            title: '我的毕设',
            path: '/projects/my',
            type: 'PAGE',
            icon: 'FolderKanban',
            componentKey: 'projects/my',
            sortOrder: 1,
          },
          {
            // 指导学生：教师指导学生、记录指导过程（教师）
            code: 'GUIDANCE_STUDENTS',
            title: '指导学生',
            path: '/projects/guidance',
            type: 'PAGE',
            icon: 'UserCheck',
            componentKey: 'projects/guidance',
            sortOrder: 2,
          },
          {
            // 过程材料审核：开题、中期、论文材料审核（教师/院系/学校）
            code: 'PROCESS_REVIEW',
            title: '过程材料审核',
            path: '/process/reviews',
            type: 'PAGE',
            icon: 'FileCheck2',
            componentKey: 'process/reviews',
            sortOrder: 3,
          },
          {
            // 进度监控：院系和学校查看整体进度（院系/学校/超管）
            code: 'PROCESS_MONITOR',
            title: '进度监控',
            path: '/process/monitor',
            type: 'PAGE',
            icon: 'TrendingUp',
            componentKey: 'process/monitor',
            sortOrder: 4,
          },
        ],
      },
      {
        // 论文与答辩目录
        code: 'THESIS_DEFENSE',
        title: '论文与答辩',
        path: null,
        type: 'DIRECTORY',
        icon: 'FileText',
        sortOrder: 3,
        children: [
          {
            // 论文提交：上传论文、版本管理（学生）
            code: 'THESIS_SUBMISSION',
            title: '论文提交',
            path: '/thesis/submission',
            type: 'PAGE',
            icon: 'Upload',
            componentKey: 'thesis/submission',
            sortOrder: 1,
          },
          {
            // 论文评阅：评阅论文、填写评语（教师）
            code: 'THESIS_REVIEW',
            title: '论文评阅',
            path: '/thesis/review',
            type: 'PAGE',
            icon: 'FileSearch',
            componentKey: 'thesis/review',
            sortOrder: 2,
          },
          {
            // 答辩管理：答辩时间、分组、地点、成员（教师/院系/学校）
            code: 'DEFENSE_MANAGEMENT',
            title: '答辩管理',
            path: '/defense',
            type: 'PAGE',
            icon: 'Presentation',
            componentKey: 'defense/index',
            sortOrder: 3,
          },
          {
            // 成绩管理：成绩录入、审核、查询（院系/学校）
            code: 'GRADE_MANAGEMENT',
            title: '成绩管理',
            path: '/grades',
            type: 'PAGE',
            icon: 'Award',
            componentKey: 'grades/index',
            sortOrder: 4,
          },
          {
            // 成果归档：最终论文、答辩资料、毕业成果（院系/学校）
            code: 'ACHIEVEMENT_ARCHIVE',
            title: '成果归档',
            path: '/archives',
            type: 'PAGE',
            icon: 'Archive',
            componentKey: 'archives/index',
            sortOrder: 5,
          },
        ],
      },
    ],
  },
  {
    // AI 助手：AI 对话、选题、文献和写作辅助（全角色）
    code: 'AI_ASSISTANT',
    title: 'AI 助手',
    path: '/ai-assistant',
    type: 'PAGE',
    icon: 'Bot',
    componentKey: 'ai-assistant/index',
    sortOrder: 20,
  },
  {
    // 组织与人员管理目录
    code: 'ORGANIZATION',
    title: '组织与人员管理',
    path: null,
    type: 'DIRECTORY',
    icon: 'Users',
    sortOrder: 30,
    children: [
      {
        // 用户管理：学生、教师及管理员账号（超管/学校/院系）
        code: 'USER_MANAGEMENT',
        title: '用户管理',
        path: '/users',
        type: 'PAGE',
        icon: 'Users',
        componentKey: 'users/index',
        sortOrder: 1,
      },
      {
        // 院系管理：院系信息维护（超管/学校）
        code: 'DEPARTMENT_MANAGEMENT',
        title: '院系管理',
        path: '/departments',
        type: 'PAGE',
        icon: 'Building2',
        componentKey: 'departments/index',
        sortOrder: 2,
      },
      {
        // 专业管理：专业信息及所属院系（超管/学校/院系）
        code: 'MAJOR_MANAGEMENT',
        title: '专业管理',
        path: '/majors',
        type: 'PAGE',
        icon: 'BookMarked',
        componentKey: 'majors/index',
        sortOrder: 3,
      },
    ],
  },
  {
    // 系统管理目录
    code: 'SYSTEM',
    title: '系统管理',
    path: null,
    type: 'DIRECTORY',
    icon: 'Settings',
    sortOrder: 90,
    children: [
      {
        // 角色管理：固定系统角色及其关联配置（超管/学校）
        code: 'ROLE_MANAGEMENT',
        title: '角色管理',
        path: '/roles',
        type: 'PAGE',
        icon: 'ShieldCheck',
        componentKey: 'roles/index',
        sortOrder: 1,
      },
      {
        // 菜单管理：菜单树、排序、可见性管理（仅超管）
        code: 'MENU_MANAGEMENT',
        title: '菜单管理',
        path: '/menus',
        type: 'PAGE',
        icon: 'ListTree',
        componentKey: 'menus/index',
        sortOrder: 2,
      },
    ],
  },
]
