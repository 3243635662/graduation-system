# Phase 1 实施报告：核心组织、账户、人员与授权

> 依据：`docs/毕业设计管理系统_完整重构架构与Agent实施任务书.md` Phase 1
> 日期：2026-11-15
> 范围：数据库重建 + RBAC 域后端 API + 前端管理页；不含任何毕业设计业务流程表

---

## 1. 实施摘要

| 项                | 结果                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------- |
| Prisma 模型       | 18 个（原 16 个中删除 1 个字段族、重构 2 个、新增 2 个）                               |
| 迁移历史          | 9 个旧迁移归档，重建为 **1 个初始迁移**                                                |
| 新增/重构后端模块 | 工作人员档案（新）、学生档案、教师档案、用户、角色授权、组织、认证                     |
| 新增前端页面      | 账号、学生、教职工、角色授权、组织架构、个人资料、审计日志、班主任/辅导员/协管（只读） |
| 单元测试          | **369 / 369 通过**                                                                     |
| E2E               | **139 / 139 通过**（真实 MySQL + Redis）                                               |
| 类型检查          | 后端 `tsc --noEmit` 0 错误；前端 `vue-tsc -b` 通过                                     |
| Lint / Build      | 后端 0 error、构建通过；前端 0 error、构建通过                                         |
| Schema 漂移       | `prisma migrate diff --from-config-datasource` → **No difference detected**            |

---

## 2. 数据库重建记录

- 目标：`127.0.0.1:3306` / 数据库 `graduation_system`（影子库 `graduation_system_shadow`），本地 Docker MySQL 8.4.13。
- 已确认不是远程/生产库，且未执行 `docker compose down -v`，未删除任何 Docker volume。
- 操作：删除并重建 `graduation_system` 与 `graduation_system_shadow`（`utf8mb4 / utf8mb4_0900_ai_ci`），清空旧 `_prisma_migrations`，应用新迁移并执行 Seed。
- 报告中不含用户名、密码或完整连接串。

### 数据现状（Seed 后）

- 正式 Seed：7 个角色、32 个权限、81 条角色权限、15 个菜单节点、38 条角色菜单、1 个学校根组织、1 个学校管理员账号。
- 开发演示 Seed（`DEV_SEED_CONFIRM=true`）：9 个组织节点、3 名学生、3 名工作人员（其中 2 名教师）、1 条班主任任职、1 条辅导员分配、6 条角色授权。
- 两个 Seed 二次执行均 **新增 0 条**，幂等成立。

---

## 3. Migration

- 旧迁移归档：`docs/ProjectAudit/archive/prisma-migrations-before-rebuild/`（9 个目录 + `migration_lock.toml`，原始 SQL 完整保留）。
- 新初始迁移：`backend/prisma/migrations/20261116000000_init_phase1_rbac/migration.sql`（509 行）。
- 空库验证：`prisma migrate reset --force` 在全新数据库上完整创建当前 Schema，无手工补丁。
- 漂移验证：`prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` 返回 0。

---

## 4. 最终 ER 图（Phase 1）

```mermaid
erDiagram
  ORGANIZATION_UNIT ||--o{ ORGANIZATION_UNIT : parent_child
  USER ||--o| STUDENT_PROFILE : has
  USER ||--o| PERSONNEL_PROFILE : has
  PERSONNEL_PROFILE ||--o| TEACHER_PROFILE : specializes
  ORGANIZATION_UNIT ||--o{ PERSONNEL_PROFILE : primary_org
  ORGANIZATION_UNIT ||--o{ STUDENT_PROFILE : current_class
  STUDENT_PROFILE ||--o{ STUDENT_CLASS_TRANSFER : transfers

  USER ||--o{ USER_ROLE : receives
  ROLE ||--o{ USER_ROLE : assigned
  ORGANIZATION_UNIT o|--o{ USER_ROLE : scope
  USER_ROLE ||--o| USER_ROLE_HISTORY : archived_as
  ROLE ||--o{ USER_ROLE_HISTORY : referenced
  ROLE ||--o{ ROLE_PERMISSION : grants
  PERMISSION ||--o{ ROLE_PERMISSION : included
  ROLE ||--o{ ROLE_MENU : includes
  MENU ||--o{ ROLE_MENU : shown_to

  TEACHER_PROFILE ||--o{ TEACHER_CLASS_DUTY : performs
  ORGANIZATION_UNIT ||--o{ TEACHER_CLASS_DUTY : class
  USER ||--o{ COUNSELOR_CLASS_ASSIGNMENT : coordinator
  ORGANIZATION_UNIT ||--o{ COUNSELOR_CLASS_ASSIGNMENT : class
  USER ||--o{ COORDINATOR_QUALIFICATION_OVERRIDE : override

  USER ||--o{ AUTH_SESSION : sessions
  USER ||--o{ AUDIT_LOG : acts
```

关键基数：

- `User 1 ── 0..1 StudentProfile`（`userId` 唯一且必填）
- `User 1 ── 0..1 PersonnelProfile`（`userId` 唯一且必填）
- `PersonnelProfile 1 ── 0..1 TeacherProfile`（`personnelProfileId` 唯一）
- `UserRole` 唯一键 `(userId, roleId, scopeKey)`，同一用户同一角色同一范围只有一条当前授权
- `UserRoleHistory` 无唯一约束，只追加

---

## 5. 与任务书不一致之处（均有理由）

| 项           | 任务书                     | 实际实现                                                    | 理由                                                                             |
| ------------ | -------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 姓名字段     | `username` + `displayName` | 只保留 `realName`                                           | 用户明确要求「毕设系统必须真名，不要 display 名」。真名不唯一，不能当登录名      |
| 登录标识     | 未明确                     | 邮箱 / 学号 / 教师工号 / 工作人员工号                       | 保留既有邮箱注册链路，同时支持学生用学号、教师用工号登录                         |
| 平台超管账号 | §17.1 要求创建             | 只保留角色模板，不创建账号                                  | 用户明确选择沿用「不创建平台超管账号」的既有决策                                 |
| 教师院系调整 | 未明确                     | 移到 `PATCH /personnel-profiles/:id`                        | 教师所属组织统一由 `PersonnelProfile.primaryOrganizationUnit` 表达，避免两份真相 |
| 协管资格来源 | §7.2 四条规则              | `STUDENT_SELF / HEAD_TEACHER / COUNSELOR / SCHOOL_OVERRIDE` | 删除原「同专业班助候选」，落实「学生只能协管本人当前班级」                       |

---

## 6. API 总览（Phase 1）

### 认证与本人资料

| 方法  | 路径                    | 权限                                          |
| ----- | ----------------------- | --------------------------------------------- |
| POST  | `/api/auth/register`    | 公开（邮箱验证码）                            |
| POST  | `/api/auth/login`       | 公开（`identifier` + password）               |
| POST  | `/api/auth/refresh`     | Cookie                                        |
| POST  | `/api/auth/logout`      | 登录态                                        |
| GET   | `/api/auth/me`          | 登录态（返回 realName/avatarUrl/permissions） |
| PATCH | `/api/users/me/profile` | 登录态                                        |

### 组织 / 用户 / 人员

| 方法           | 路径                                 | 权限                            |
| -------------- | ------------------------------------ | ------------------------------- |
| GET            | `/api/organizations/tree`            | `organization:unit:read`        |
| GET            | `/api/organizations/:id`             | `organization:unit:read`        |
| POST           | `/api/organizations`                 | `organization:unit:create`      |
| PATCH          | `/api/organizations/:id`             | `organization:unit:update`      |
| GET            | `/api/users`、`/api/users/:id`       | `user:read`                     |
| PATCH          | `/api/users/:id`                     | `user:update`                   |
| GET/POST/PATCH | `/api/student-profiles*`             | `student:profile:*`             |
| POST           | `/api/student-profiles/:id/transfer` | `student:profile:transfer`      |
| PATCH          | `/api/student-profiles/:id/status`   | `student:profile:status:update` |
| GET/POST/PATCH | `/api/personnel-profiles*`           | `personnel:profile:*`           |
| GET/POST/PATCH | `/api/teacher-profiles*`             | `teacher:profile:*`             |
| PATCH          | `/api/teacher-profiles/:id/status`   | `teacher:profile:status:update` |

### 角色授权 / 班级事务 / 审计

| 方法     | 路径                                      | 权限                          |
| -------- | ----------------------------------------- | ----------------------------- |
| GET      | `/api/roles`                              | `rbac:role:read`              |
| GET      | `/api/role-assignments/users/:id`         | `rbac:role-assignment:read`   |
| GET      | `/api/role-assignments/users/:id/history` | `rbac:role-assignment:read`   |
| POST     | `/api/role-assignments`                   | `rbac:role-assignment:assign` |
| DELETE   | `/api/role-assignments/:id`               | `rbac:role-assignment:revoke` |
| GET/POST | `/api/teacher-class-duties*`              | `organization:class-duty:*`   |
| GET/POST | `/api/counselor-class-assignments*`       | `organization:counselor:*`    |
| GET/POST | `/api/coordinator-overrides*`             | `coordinator:override:*`      |
| GET      | `/api/audit-logs`                         | `audit:log:read`              |

---

## 7. 关键约束的落点

1. **角色授权唯一性**：`@@unique([userId, roleId, scopeKey])`，`scopeKey` 为 `'GLOBAL'` 或组织节点 ID；重复分配由数据库拒绝，`P2002` 映射 409。
2. **撤销可追溯**：事务内先写 `UserRoleHistory`（含 `roleCode`、`scopeKey`、操作人、原因）再删除当前行；撤销后可重新分配。
3. **学生档案绑定账号**：`userId` 非空唯一；未分班学生 `classId` 为空，只允许覆盖全校范围的账号查询 `unassignedOnly`。
4. **班级归属变更留痕**：首次分班与转班共用 `POST /student-profiles/:id/transfer`，写 `StudentClassTransfer`（`fromClassId` 可为空）；事务内先按旧班级重算协管资格，再更新 `classId`。
5. **协管资格实时判定**：`CoordinatorEligibilityService` 同时用于分配校验与运行时过滤；资格失效时同事务写历史并删除授权。
6. **审计**：动作编码 `^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$`，业务审计与业务变更同事务。
7. **菜单只控可见性**：`/auth/me.permissions` 供前端隐藏入口，后端每个请求仍由 `PermissionsGuard` 实时鉴权。

---

## 8. 已知限制

1. 账号管理页目前只读；后端已有 `PATCH /users/:id`，前端后续可接入状态修改。
2. 班主任任职、辅导员分配、协管授权三页只读，创建/撤销接口已就绪但未做表单。
3. `GET /users` 未传 `status` 时默认只返回 `ACTIVE`，前端「全部状态」选项实际等同于正常账号。
4. 学生档案列表的 `unassignedOnly` 只允许全校范围账号使用；院系/专业管理员会收到 403。
5. 角色授权唯一键不含有效期，已过期但未撤销的授权会阻塞重新分配，需先撤销。
6. 前端未做按钮级权限隐藏，依赖后端 403 兜底。

---

## 9. 下一步（Phase 2 预备）

- 毕业批次：`GraduationBatch` / `BatchStage` / `BatchStudent` / 学院配置
- 批次名单 Excel 导入预览与确认
- 批次参与与「一个当前有效批次」的服务层并发规则
