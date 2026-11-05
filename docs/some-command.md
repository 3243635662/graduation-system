# 常用开发命令速查

### 1. 启动容器（Docker）

```bash
# 启动Docker Desktop
docker desktop start

# 启动全部容器（MySQL + Redis + ChromaDB）
docker compose up -d

# 单独启动 MySQL
docker compose up -d mysql

# 单独启动 Redis
docker compose up -d redis

# 单独启动 ChromaDB（向量数据库）
docker compose up -d chroma

# 查看容器运行状态
docker compose ps

# 停止容器
docker compose down
```

---

### 2. 启动前后端服务

```bash
# 同时启动前端和后端
pnpm dev

# 仅启动前端（访问地址：http://localhost:5173）
pnpm dev:frontend

# 仅启动后端（API 地址：http://localhost:3000/api）
pnpm dev:backend

# 启动共享包的类型监听编译（@graduation/shared）
pnpm --filter @graduation/shared dev
```

---

### 3. 数据库与 Prisma

```bash
# 生成 Prisma 客户端代码
pnpm --filter backend exec prisma generate

# 执行数据库迁移
pnpm --filter backend exec prisma migrate dev

# 打开数据库可视化管理面板（http://localhost:5555）
pnpm --filter backend exec prisma studio
```

---

### 4. 检查、构建与测试

```bash
# TypeScript 全仓类型检查
pnpm typecheck

# 代码规范检查（oxlint）
pnpm lint

# 自动修复代码规范问题
pnpm lint:fix

# 代码格式化（oxfmt）
pnpm format

# 全仓打包构建
pnpm build

# 运行测试
pnpm test
```
