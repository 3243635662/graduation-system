# Graduation System

基于 **Vue 3 + shadcn-vue** 前端与 **NestJS** 后端的毕业设计项目，使用 **pnpm workspace** 组织为单仓库（monorepo），前后端共用一套 oxc 代码检查/格式化规则与一份共享类型包。

- 前端：沿用 [shadcn-vue-admin](https://github.com/Whbbit1999/shadcn-vue-admin) 模板（后台布局、主题、数据表格、表单、国际化等），在此基础上开发业务页面。
- 后端：NestJS 脚手架，已统一 `/api` 路由前缀、CORS 与 `.env` 加载。
- 共享层：`packages/shared` 提供前后端共用的响应结构、分页类型、常量与枚举。

> 当前业务功能仍在开发中，本文档随功能迭代持续补充。

## 目录

- [技术栈](#技术栈)
- [目录结构](#目录结构)
- [环境要求](#环境要求)
- [快速开始](#快速开始)
- [常用命令](#常用命令)
- [接口约定](#接口约定)
- [共享包 `@graduation/shared`](#共享包-graduationshared)
- [前端开发约定](#前端开发约定)
- [后端开发约定](#后端开发约定)
- [代码规范与 Git 工作流](#代码规范与-git-工作流)
- [测试](#测试)
- [常见问题](#常见问题)
- [后续计划](#后续计划)
- [许可证与致谢](#许可证与致谢)

## 技术栈

| 层次                 | 主要依赖                                                                           |
| -------------------- | ---------------------------------------------------------------------------------- |
| 前端框架             | Vue 3.5+、TypeScript 6、Vite 8                                                     |
| UI                   | shadcn-vue、reka-ui 2、Tailwind CSS 4、@lucide/vue                                 |
| 路由与状态           | vue-router 5（unplugin-vue-router 基于文件生成）、vite-plugin-vue-layouts、Pinia 4 |
| 数据                 | TanStack Vue Query 5、TanStack Vue Table 9、ofetch                                 |
| 表单与校验           | TanStack Vue Form、Zod 4（vee-validate 亦在依赖中）                                |
| 国际化 / 图表 / 动效 | vue-i18n 11、Unovis、motion-v、@formkit/auto-animate                               |
| 后端框架             | NestJS 12（Express 平台）                                                          |
| 测试                 | Vitest 5（前端）、Vitest 4（后端，含 e2e）                                         |
| 规范工具             | oxlint 1.90、oxfmt 0.75、oxlint-tsgolint（后端 type-aware）                        |
| 包管理               | pnpm 11.28.6（workspace + catalog）                                                |

## 目录结构

```
graduation-system/
├─ package.json              # 根脚本、共享 devDependencies、git hooks 配置
├─ pnpm-workspace.yaml       # workspace 包声明、catalog（统一工具版本）、pnpm 策略
├─ pnpm-lock.yaml            # 全仓唯一 lockfile
├─ .oxlintrc.json            # 全仓 lint 基础规则
├─ .oxfmtrc.json             # 全仓唯一格式化配置
├─ .github/workflows/        # CI（lint / typecheck / test / build）
├─ frontend/                 # 前端应用（Vue3 + shadcn-vue-admin）
│  ├─ src/pages/             # 页面（路由按文件结构自动生成）
│  ├─ src/components/        # 业务组件；components/ui 为 shadcn 生成组件
│  ├─ src/services/          # API 封装（ofetch + TanStack Query）
│  ├─ src/plugins/i18n/      # 中英文文案
│  └─ .oxlintrc.json         # 继承根配置，追加 vue / browser 环境
├─ backend/                  # 后端应用（NestJS）
│  ├─ src/                   # 模块、控制器、服务
│  ├─ test/                  # e2e 测试
│  └─ .oxlintrc.json         # 继承根配置，追加 node 环境与后端规则
├─ packages/
│  └─ shared/                # @graduation/shared：前后端共享类型/常量/枚举
└─ docs/                     # 主题等文档资源
```

## 环境要求

- **Node.js ≥ 22.15**（CI 使用 Node 22）
- **pnpm ≥ 10**，推荐直接使用 `packageManager` 指定的 `pnpm@11.28.6`（`corepack enable` 可自动对齐）
- 无需全局安装 TypeScript / oxc，均由项目依赖提供

## 快速开始

```bash
# 1. 克隆
git clone https://github.com/3243635662/graduation-system.git
cd graduation-system

# 2. 安装依赖（会同时构建 @graduation/shared 并安装 git hooks）
pnpm install

# 3. 一键启动前后端
pnpm dev
```

启动后：

- 前端 http://localhost:5173
- 后端 http://localhost:3000/api

### 环境变量

前后端各自读取包内 `.env`（已被忽略，不提交），示例文件：

- `frontend/.env.example`

  ```dotenv
  VITE_SERVER_API_URL=http://localhost:3000
  VITE_SERVER_API_PREFIX=/api
  VITE_SERVER_API_TIMEOUT=5000
  ```

  **不配置也能联调**：`vite.config.ts` 已把 `/api` 代理到 `http://localhost:3000`，此时请求走同源相对路径。

- `backend/.env.example`

  ```dotenv
  PORT=3000
  CORS_ORIGIN=http://localhost:5173
  ```

  `CORS_ORIGIN` 支持逗号分隔多个来源；`.env` 由 `process.loadEnvFile()` 在 `main.ts` 中加载，缺失时使用默认值。

## 常用命令

根目录（作用于整个仓库）：

| 命令                                     | 说明                                           |
| ---------------------------------------- | ---------------------------------------------- |
| `pnpm dev`                               | 并行启动前端与后端（启动前自动构建共享包）     |
| `pnpm dev:frontend` / `pnpm dev:backend` | 单独启动某一端                                 |
| `pnpm build`                             | 按依赖顺序构建 shared → backend → frontend     |
| `pnpm lint` / `pnpm lint:fix`            | oxlint 全仓检查 / 自动修复                     |
| `pnpm lint:backend`                      | 后端 type-aware 检查（依赖 `oxlint-tsgolint`） |
| `pnpm format` / `pnpm format:check`      | oxfmt 全仓格式化 / 校验                        |
| `pnpm typecheck`                         | 各包类型检查（shared + frontend）              |
| `pnpm test`                              | 前端单测 + 后端单测                            |

针对单个包：

```bash
pnpm --filter frontend build
pnpm --filter frontend test:run
pnpm --filter backend start:dev
pnpm --filter backend test:e2e
pnpm --filter @graduation/shared build
```

前端包内脚本：`dev`、`build`（`vue-tsc -b && vite build`）、`preview`、`typecheck`、`test`、`test:run`。

后端包内脚本：`dev` / `start:dev`（watch）、`start`、`start:prod`、`build`、`test`、`test:e2e`、`test:cov`、`lint`、`format`。

## 接口约定

- **全局前缀**：后端所有路由挂在 `/api` 下（`main.ts` 中 `app.setGlobalPrefix(API_PREFIX)`），常量来自共享包，避免两端各写一份。
- **统一响应结构**（`packages/shared/src/types/response.type.ts`）：

  ```ts
  interface IResponse<T, E = Record<string, any>> {
    data: T
    extra: E
    code: number
    message: string
    success: boolean
  }
  ```

- **分页**：`IPaginationRequestQuery`、`IRequestQuery<T>`（分页 + 业务筛选）、`IPaginatedData<T>`。
- **排序**：`SortOrder` 枚举（`asc` / `desc`）。
- **前端请求**：`src/lib/api-client.ts` 基于 ofetch 创建 `apiFetch`，`baseURL` 由 `API_BASE_URL` 拼接；401 会自动清理登录态并跳转登录页。业务接口封装放在 `src/services/api/`，配合 TanStack Query 的 `useQuery` / `useMutation` 使用。

## 共享包 `@graduation/shared`

用于存放**前后端都需要**的内容：DTO 类型、响应结构、分页参数、枚举、常量。

- 该包用 `tsc` 编译到 `dist`（ESM + `.d.ts`），两端通过 `@graduation/shared` 直接 import。
- 改完共享包源码后需要重新构建：

  ```bash
  pnpm --filter @graduation/shared build
  ```

  或直接运行 `pnpm dev`（`predev` 会自动构建）。`pnpm install` 的 `postinstall` 也会构建一次。

- 新增导出：在 `src/index.ts` 中 `export *` 对应文件即可。
- 前端 `src/services/types/response.type.ts` 已从该包 re-export，历史 import 路径无需改动。

## 前端开发约定

- **路由自动化**：`src/pages/` 下的文件即路由（unplugin-vue-router）。`components/`、`layouts/`、`data/`、`types/` 不参与路由生成。
- **布局**：默认布局为 `layouts/default.vue`；`pages/auth.vue`、`pages/errors.vue` 通过 `<route>` 块关闭默认布局。
- **自动导入**：`vue`、`vue-router` API，以及 `src/composables`、`src/constants`、`src/stores`、`src/components` 下的导出都可直接使用，无需手写 import。对应类型文件 `src/types/auto-import.d.ts`、`route-map.d.ts` 由插件生成，**不要手改，也不纳入 oxc**。
- **UI 组件**：优先使用 `src/components/ui` 中的 shadcn 组件；新增组件在 `frontend` 目录执行：

  ```bash
  pnpm dlx shadcn-vue@latest add dialog
  ```

  `components/ui/**` 由 CLI 生成，已排除在 oxlint/oxfmt 之外，避免与生成器互相覆盖。

- **主题**：基础变量在 `src/assets/index.css`，可选主题覆盖在 `src/assets/themes.css`，自定义主题面板在 `src/components/custom-theme/`。
- **国际化**：文案位于 `src/plugins/i18n/en.json`、`zh.json`，新增文案两边同步。
- **图标**：通用图标用 `@lucide/vue`（组件形式导入）；品牌图标用 `@iconify/vue` 的字符串形式。

## 后端开发约定

- 生成模块 / 控制器 / 服务（在根目录执行，注意 `--filter`）：

  ```bash
  pnpm --filter backend exec nest g module user
  pnpm --filter backend exec nest g controller user
  pnpm --filter backend exec nest g service user
  ```

- 新建控制器无需手写前缀，全局已挂 `/api`。
- 环境变量通过 `.env`（`backend/.env`）或系统环境变量注入，不要再引入 dotenv 类依赖。
- e2e 测试里通过 `app.setGlobalPrefix('api')` 复现全局前缀（见 `test/app.e2e-spec.ts`）。
- 编译产物输出到 `backend/dist`，构建前会清空（`nest-cli.json` 的 `deleteOutDir`）。

## 代码规范与 Git 工作流

- **单一工具链**：全仓使用 oxlint + oxfmt，配置在根目录；各包用 `extends` 追加环境差异（前端 `vue`/`browser`，后端 `node`）。
- **编辑器**：推荐安装 `.vscode/extensions.json` 中的 `oxc.oxc-vscode`，保存时自动格式化与修复。
- **提交钩子**（`simple-git-hooks`）：
  - `pre-commit`：`nano-staged` 对暂存文件执行 `oxlint --fix` + `oxfmt`
  - `pre-push`：`pnpm lint`
- **注意**：Windows 下单次暂存文件过多（约 100+）会触发命令行长度限制，批量格式化请按目录分批提交。
- **分支**：主分支 `main`；迁移前的状态保留在本地 tag `pre-monorepo`。

## 测试

```bash
pnpm test                        # 全部单测
pnpm --filter frontend test      # 前端 watch 模式
pnpm --filter backend test:e2e   # 后端 e2e
pnpm --filter backend test:cov   # 覆盖率
```

前端测试放在 `src/**/__tests__/`；后端单测与被测文件同级（`*.spec.ts`），e2e 在 `test/`。

## 常见问题

- **改了共享包，前端/后端没生效**：需要重新构建 `pnpm --filter @graduation/shared build`。
- **端口被占用**：前端固定 5173（`strictPort`），后端默认 3000（可用 `PORT` 覆盖）。
- **跨域报错**：确认后端 `CORS_ORIGIN` 包含前端地址，或直接使用 Vite 代理（相对路径 `/api`）。
- **保存后没有自动格式化**：检查是否安装了 oxc 扩展、是否在仓库根目录打开项目（`frontend/.vscode` 下的旧配置已移除）。
- **提交被钩子拦截**：多为 lint 未通过或暂存文件过多，按提示修正后重试。

## 后续计划

> 随业务开发持续补充。

- [ ] 需求与用例
- [ ] 数据库设计与实体关系
- [ ] 认证与权限（登录、角色、菜单权限）
- [ ] 业务模块（待补充）
- [ ] 部署与运维说明

## 许可证与致谢

- 本项目采用 **MIT License**（见 `frontend/LICENSE`）。
- 前端基于 [shadcn-vue-admin](https://github.com/Whbbit1999/shadcn-vue-admin)（设计源自 [shadcn-admin](https://github.com/satnaing/shadcn-admin)）。
- 后端基于 [NestJS](https://nestjs.com/)。
