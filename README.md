# 理享派

基于 Nuxt 4 + Prisma + PostgreSQL 的图纸分析与 3D 建模应用，包含用户认证、工作台、历史任务与系统设置。

## 功能概览

- **图纸分析工作台（`/workspace`）**：查看识别结果、历史任务并继续效果图迭代。
- **分析结果生成 3D**：点击“识别完成”旁的“生成3D效果图”，在弹窗中自动生成带材质的可交互模型，支持旋转、缩放、DXF 导出及截图到新对话。
- **超长分析自动精简**：工作台分析超过 12000 字时，先调用大模型精简至 12000 字以下，再自动继续建模，无需用户手动删减。
- **独立 CAD 页面（`/cad`）**：通过文字或图片生成模型，也可对已有模型进行材质调整。
- **用户与系统管理**：注册、登录、密码重置、JWT 鉴权和系统设置。

## 技术栈

| 类别 | 技术 | 版本 |
|------|------|------|
| 后端框架 | Node.js | 26.4.0 |
| 前端框架 | Nuxt | ^4.4.8 |
| UI 组件库 | Element Plus | ^2.14.2 |
| Element Plus Nuxt 模块 | @element-plus/nuxt | ^1.1.5 |
| ORM | Prisma | ^7.8.0 |
| Prisma Client | @prisma/client | ^7.8.0 |
| Prisma PostgreSQL Adapter | @prisma/adapter-pg | ^7.8.0 |
| 数据库驱动 | pg | ^8.22.0 |
| 认证库 | @sidebase/nuxt-auth | ^1.3.0 |
| 密码哈希 | bcryptjs | ^3.0.3 |
| JWT | jsonwebtoken | ^9.0.3 |
| 参数校验 | Zod | ^4.4.3 |
| Vue | vue | ^3.5.38 |
| Vue Router | vue-router | ^5.1.0 |
| 环境变量 | dotenv | ^17.4.2 |
| TypeScript 执行器 | tsx | * |
| 3D 渲染 | three | ^0.186.0 |
| CSG 几何运算 | three-bvh-csg | ^0.0.18 |
| 大模型客户端 | openai（兼容 Qwen 接口） | ^6.45.0 |

## 项目结构

以下为认证基础目录；工作台与 CAD 相关文件见后续章节。

```
lixiangpai/
├── app/                          # 前端应用
│   ├── app.vue                   # 根组件，渲染 NuxtLayout + NuxtPage
│   ├── layouts/
│   │   └── default.vue           # 全局布局：顶栏（Logo + 用户信息/登录按钮）+ 主内容区
│   ├── middleware/
│   │   └── auth.ts               # 认证中间件：未登录重定向到 /login
│   └── pages/
│       ├── index.vue             # 首页：重定向到 /dashboard（需登录）
│       ├── login.vue             # 登录页：邮箱+密码表单，Element Plus 表单校验（已登录自动跳转）
│       ├── register.vue          # 注册页：姓名+邮箱+手机+密码+确认密码
│       ├── dashboard.vue         # 仪表盘：展示用户信息卡片，提供退出登录
│       ├── forgot-password.vue   # 忘记密码：输入邮箱，生成重置令牌（仅未登录可访问）
│       └── reset-password.vue    # 重置密码：通过 URL token 验证，设置新密码（仅未登录可访问）
├── server/                       # 服务端 API
│   ├── api/
│   │   └── auth/
│   │       ├── login.post.ts     # POST /api/auth/login — 用户登录，返回 JWT
│   │       ├── register.post.ts  # POST /api/auth/register — 用户注册，返回 JWT
│   │       ├── logout.post.ts    # POST /api/auth/logout — 退出登录
│   │       ├── me.get.ts         # GET /api/auth/me — 获取当前用户信息
│   │       ├── forgot-password.post.ts  # POST /api/auth/forgot-password — 生成密码重置令牌（防枚举）
│   │       └── reset-password.post.ts   # POST /api/auth/reset-password — 使用令牌重置密码（事务更新）
│   │   └── settings/
│   │       ├── index.get.ts      # GET /api/settings — 获取全部系统设置
│   │       ├── index.post.ts     # POST /api/settings — 创建/更新系统设置（upsert）
│   │       ├── [key].get.ts      # GET /api/settings/:key — 获取单个设置
│   │       └── [key].delete.ts   # DELETE /api/settings/:key — 删除设置
│   └── utils/
│       ├── auth.ts               # 认证工具：密码哈希/验证、JWT 生成/验证、Token 提取
│       └── prisma.ts             # Prisma 客户端：PostgreSQL 连接池 + schema 路由 + 开发环境单例
├── prisma/
│   ├── schema.prisma             # 数据模型定义：User、PasswordReset、SystemSetting
│   ├── migrations/               # Prisma 数据库迁移
│   └── seed.ts                   # 种子脚本：创建默认管理员账号 admin@admin.com（支持非 public schema）
├── public/                       # 静态资源
├── nuxt.config.ts                # Nuxt 配置：模块、认证、运行时配置、Session 刷新策略
├── package.json                  # 项目依赖与脚本
├── prisma.config.ts              # Prisma CLI 配置（dotenv 支持）
├── tsconfig.json                 # TypeScript 配置：使用 Nuxt 自动生成的配置
└── .env.example                  # 环境变量模板
```

## 数据模型

### User（用户）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | String (UUID) | 主键 |
| email | String | 邮箱，唯一 |
| phone | String? | 手机号，可选，唯一 |
| password | String | 密码，bcrypt 加密存储 |
| name | String? | 姓名，可选 |
| role | String | 角色，默认 USER |
| createdAt | DateTime | 创建时间 |
| updatedAt | DateTime | 更新时间 |

### PasswordReset（密码重置令牌）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | String (UUID) | 主键 |
| email | String | 关联邮箱 |
| token | String | 随机令牌（64 字符十六进制），唯一 |
| expiresAt | DateTime | 过期时间（1 小时） |
| used | Boolean | 是否已使用，默认 false |
| createdAt | DateTime | 创建时间 |

### SystemSetting（系统设置）

| 字段 | 类型 | 说明 |
|------|------|------|
| key | String | 设置键，主键 |
| value | String | 设置值 |
| updatedAt | DateTime | 更新时间 |

## 核心实现逻辑

### 认证流程

```
┌──────────┐     POST /api/auth/login     ┌─────────┐
│  用户    │ ───────────────────────────→ │  服务端  │
│  前端    │                              │  API     │
└──────────┘                              └─────┬────┘
          ←───────────────────────────────────┘
                  返回 { token, user }
                        │
                        ▼
            ┌──────────────────────┐
            │ @sidebase/nuxt-auth  │
            │  存储 JWT 到 cookie   │
            └──────────────────────┘
                        │
                        ▼
            ┌──────────────────────┐
            │  跳转到 /dashboard    │
            └──────────────────────┘
```

1. **登录**：前端提交邮箱密码 → 后端验证密码（bcrypt.compare）→ 生成 JWT（24h 过期）→ 返回 token
2. **已登录用户访问登录页**：自动检测 status === 'authenticated' 并跳转到 /dashboard
3. **注册**：前端提交注册信息 → 后端校验邮箱/手机号唯一性 → 密码哈希（bcrypt）→ 创建用户 → 返回 JWT
4. **鉴权**：`@sidebase/nuxt-auth` 自动从 cookie 读取 token → 调用 `GET /api/auth/me` 验证 → 前端 auth 中间件检查 status
5. **JWT 验证**：服务端从 Authorization Bearer header 提取 token → jwt.verify 验证签名和过期时间
6. **Session 刷新**：窗口获得焦点时自动刷新，禁用定期自动刷新

### 密码重置流程

```
1. 用户输入邮箱 → POST /api/auth/forgot-password
2. 服务端生成 64 位随机 token（32 bytes hex），存入 PasswordReset 表，1 小时过期
3. 无论邮箱是否存在，统一返回成功信息（防止邮箱枚举攻击）
4. TODO: 发送邮件（包含重置链接 /reset-password?token=xxx）
5. 用户点击链接 → 前端从 URL query 获取 token
6. POST /api/auth/reset-password → 验证 token 有效性 → 事务性更新密码 + 标记已使用
```

### 系统设置 API

采用 Key-Value 模式，支持 CRUD 操作：
- **创建/更新**：`POST /api/settings` 使用 Prisma `upsert` 实现存在则更新、不存在则创建
- **删除**：`DELETE /api/settings/:key`
- 所有操作均需登录鉴权

### 数据库连接

使用 `@prisma/adapter-pg` + `pg.Pool` 连接 PostgreSQL，支持从 `DATABASE_URL` 中解析 schema 参数，通过 `search_path` 路由到指定 schema。开发环境使用全局单例模式避免热重载时创建多个连接。

## 工作台与 CAD 3D 建模

### 使用流程

1. 在 `/workspace` 完成图纸识别，或打开包含分析结果的历史任务。
2. 点击该条消息“识别完成”旁的“生成3D效果图”。只有包含分析数据的消息显示入口，仅含效果图的迭代消息不显示。
3. 弹窗首次打开时自动生成，复用 `/cad` 的生成接口与 `CadViewer3D` 渲染组件，无需跳转页面。
4. 生成后可拖拽旋转、滚轮缩放、保存 DXF，或将 PNG 截图添加到工作台新对话。截图不会自动发送；有任务进行中时需等待任务完成。
5. 可展开“查看 / 调整分析内容”后重新生成；重新生成失败时保留原模型，并支持一键重试。

建模输入取自当前消息的 `drawing_info`、`elements`、`spaces`、`dimensions`、`annotations`、`summary`、`suggestion` 完整内容，不受列表展示条数限制，也不包含图片地址、统计信息或其他轮次结果。

同一条消息的模型、摘要和实际建模文本缓存在当前页面内存中，关闭后重新打开不会重复生成；刷新页面或重新加载历史任务后不保留该缓存。关闭弹窗会取消前端请求并忽略迟到响应，但不保证服务端已发起的模型调用同步终止。

### 超长分析自动精简

工作台默认发送 `autoCompact: true`，整个流程在同一次生成请求中完成：

```text
当前消息的图纸分析
  ├─ 不超过 12000 字 → 直接建模
  └─ 超过 12000 字 → 分段调用文档模型精简
                      → 校验合并结果少于 12000 字
                      → 继续建模并校验 CadModel
                      → 返回模型和精简文本，回填并缓存
```

- 原始分析最多接受 200000 字；长度以去除首尾空白后的 JavaScript `String.length`（UTF-16 码元）计算，包含标点、空格和换行。
- 超长分析完整分段，每段最多 24000 字，优先在换行处分割且不拆开 UTF-16 代理对；分段预算包含合并时的分隔符。
- 每段最多尝试 3 次（含首次），遇到模型异常、空输出或超出预算时自动重试，不通过硬截字符串满足上限。
- 提示词要求保留尺寸及单位、部件数量、布局与连接关系、孔洞、材质和修改建议，合并重复描述；实际信息保留质量仍取决于模型输出。
- 精简失败返回错误，不继续建模；用户只需点击弹窗底部按钮重试，无需手工删减。
- 复用现有 `callQwenDoc` 与 Qwen 配置，不需要额外配置独立精简服务。精简会增加模型调用次数和等待时间。

### CAD 生成接口

`POST /api/cad/generate`，需登录鉴权。

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `text` | `""` | 文字需求或图纸分析；常规上限 12000 字，生成模式启用自动精简后上限为 200000 字 |
| `mode` | `"generate"` | `generate` 生成模型；`material` 仅调整现有模型材质 |
| `autoCompact` | `false` | 仅生成模式支持超长文本自动精简；`material` 模式仍受 12000 字限制 |
| `imageBase64` | `""` | 可选，不含 `data:` 前缀的纯 Base64，字符串最长 20000000 |
| `mediaType` | `"image/jpeg"` | 支持 JPEG、PNG、WebP、GIF 对应的 MIME 类型 |
| `currentModel` | 无 | `material` 模式必需，须通过 `CadModel` 校验且序列化长度不超过 100000 |

文字和图片至少提供一项。工作台仅发送分析文本；独立 CAD 页面支持图片输入。图片输入走视觉模型，纯文本输入走文档模型。未显式启用 `autoCompact` 的调用保持原有长度限制。

工作台请求示例：

```json
{
  "text": "柜体宽600mm、高2400mm、深400mm，胡桃木层板与金属支架，保留原布局。",
  "mode": "generate",
  "autoCompact": true
}
```

成功返回 `{ success, model, title, summary }`；发生精简时额外返回 `normalizedText`，供前端回填和缓存。参数错误返回 400，未登录返回 401，精简失败返回 502，建模结构或材质校验失败返回 422。

### 相关文件

| 文件 | 职责 |
|------|------|
| `app/pages/workspace.vue` | 分析结果入口、弹窗、请求隔离、消息内缓存及截图回填 |
| `app/pages/cad.vue` | 独立文字 / 图片建模与材质编辑页面 |
| `app/components/cad/Viewer3D.client.vue` | Three.js 渲染、交互控制、PNG 截图和纯前端 DXF 导出 |
| `shared/types/cad.ts` | `CadModel` 建模 DSL 类型 |
| `server/api/cad/generate.post.ts` | 鉴权、入参校验、自动精简与生成调用编排 |
| `server/utils/cad/compact.ts` | 分段精简、长度预算、自动重试 |
| `server/utils/cad/prompts.ts` | 建模与材质编辑提示词 |
| `server/utils/cad/schema.ts` | 建模及材质参数校验、材质更新 |

DXF 由浏览器生成并下载，不依赖 ODA 或服务端格式转换。

## Nuxt 架构详解

### 目录约定

Nuxt 4 使用文件系统路由（File-system Routing），`app/` 目录下的文件结构自动映射为页面路由和 API 路由：

```
app/
├── app.vue           ← 根组件，所有页面的外层包装
├── layouts/
│   └── default.vue   ← 默认布局，通过 definePageMeta({ layout: 'default' }) 启用
├── middleware/
│   └── auth.ts       ← 命名中间件，通过 definePageMeta({ middleware: 'auth' }) 启用
└── pages/
    ├── index.vue     ← 路由：/
    ├── login.vue     ← 路由：/login
    ├── register.vue  ← 路由：/register
    ├── dashboard.vue ← 路由：/dashboard
    └── ...
```

### 页面路由与鉴权安排

| 文件 | 路由 | 鉴权要求 | 实现方式 |
|------|------|----------|----------|
| `index.vue` | `/` | 需登录 | `definePageMeta({ middleware: 'auth' })` + `navigateTo('/dashboard')` |
| `login.vue` | `/login` | 仅未登录可见 | 布局使用 `default.vue`，已登录自动跳转 dashboard |
| `register.vue` | `/register` | 仅未登录可见 | 同 login.vue |
| `dashboard.vue` | `/dashboard` | 需登录 | `definePageMeta({ middleware: 'auth' })` |
| `forgot-password.vue` | `/forgot-password` | 仅未登录可见 | `definePageMeta({ auth: { unauthenticatedOnly: true, navigateAuthenticatedTo: '/' } })` |
| `reset-password.vue` | `/reset-password` | 仅未登录可见 | 同上 |

**鉴权中间件流程**：
```
页面请求 → auth 中间件检查 useAuth().status
  ├─ status === 'authenticated'  → 放行
  └─ status !== 'authenticated'  → navigateTo('/login') 重定向
```

### 服务端 API 路由约定

`server/api/` 目录下的文件自动映射为 API 端点，文件命名规则：

```
server/api/
├── auth/
│   ├── login.post.ts     → POST /api/auth/login
│   ├── register.post.ts  → POST /api/auth/register
│   ├── logout.post.ts    → POST /api/auth/logout
│   ├── me.get.ts         → GET /api/auth/me
│   ├── forgot-password.post.ts  → POST /api/auth/forgot-password
│   └── reset-password.post.ts   → POST /api/auth/reset-password
└── settings/
    ├── index.get.ts      → GET /api/settings
    ├── index.post.ts     → POST /api/settings
    ├── [key].get.ts      → GET /api/settings/:key  （动态路由）
    └── [key].delete.ts   → DELETE /api/settings/:key
```

**命名规则说明**：
- `index.xxx.ts` → 目录本身作为路由（如 `settings/index.get.ts` → `/api/settings`）
- `[param].xxx.ts` → 动态路由参数（如 `[key].get.ts` → `/api/settings/:key`）
- `.get.ts` / `.post.ts` / `.delete.ts` → 限定 HTTP 方法，未限定则所有方法都匹配

**API 处理函数通用模式**：
```typescript
export default defineEventHandler(async (event) => {
  // 1. 鉴权（如需）：从 header 提取 JWT 并验证
  const payload = getUserFromToken(event)
  if (!payload) throw createError({ statusCode: 401, message: '未授权' })

  // 2. 参数校验（如需）：使用 Zod
  const body = await readValidatedBody(event, schema.parse)

  // 3. 业务逻辑：调用 prisma 操作数据库

  // 4. 返回结果
  return { data }
})
```

## Prisma 7 配置详解

### 目录结构

```
prisma/
├── schema.prisma             # 数据模型定义（核心配置文件）
├── migrations/
│   ├── 20260630091605_init/  # 迁移版本目录
│   │   └── migration.sql     # 迁移 SQL 文件
│   └── migration_lock.toml   # 数据库锁定文件（防止并发迁移）
├── seed.ts                   # 种子数据脚本（支持非 public schema）
└── ../prisma.config.ts       # Prisma CLI 配置（项目根目录，dotenv 支持）
```

### 配置方式

**1. CLI 配置**（`prisma.config.ts`，项目根目录）

```typescript
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",    // schema 文件位置
  migrations: {
    path: "prisma/migrations",        // 迁移文件存放目录
  },
  datasource: {
    url: process.env["DATABASE_URL"], // 数据库连接字符串
  },
});
```

Prisma 7 使用新的 `defineConfig` API（替代了以往的 `schema.prisma` 中的 `generator` 配置），将 CLI 配置与数据模型分离。内置 dotenv 支持。

**2. 数据模型配置**（`prisma/schema.prisma`）

```prisma
generator client {
  provider = "prisma-client-js"       // 生成 Prisma Client
}

datasource db {
  provider = "postgresql"             // 数据库类型
}

// 数据模型定义...
```

### Schema 设置详解

Prisma 7 的 schema 采用声明式 DSL，核心要素：

**数据模型声明**
```prisma
model User {
  id        String   @id @default(uuid())  // 主键 + 默认值
  email     String   @unique                // 唯一约束
  phone     String?  @unique                // 可选字段 + 唯一约束
  password  String                              // 普通字段
  name      String?                             // 可选字段
  role      String   @default("USER")          // 默认值
  createdAt DateTime @default(now())           // 默认当前时间
  updatedAt DateTime @updatedAt                // 自动更新时间

  // 关系字段：PasswordReset 通过 email 关联到 User
  passwordResets PasswordReset[]
}
```

**字段修饰符说明**

| 修饰符 | 含义 | 示例 |
|--------|------|------|
| `@id` | 主键 | `@id @default(uuid())` |
| `@unique` | 唯一约束 | `@unique` |
| `@default(value)` | 默认值 | `@default("USER")`、`@default(uuid())`、`@default(now())` |
| `@updatedAt` | 自动更新时间戳 | `@updatedAt` |
| `?` | 可空字段 | `String?` |

**关系定义**
```prisma
model PasswordReset {
  // 反向关联：通过 email 字段关联到 User 的 email
  user User @relation(fields: [email], references: [email])
}
```

- `fields: [email]` — 外键字段名
- `references: [email]` — 引用的目标字段
- 关系方向：`PasswordReset.user` → User（多对一），`User.passwordResets` → PasswordReset[]（一对多）

**枚举/复合类型**

本项目使用 String 类型模拟枚举（`role` 字段为 "USER" / "ADMIN"）。Prisma 7 原生支持 enum 类型：
```prisma
enum Role {
  USER
  ADMIN
}

model User {
  role Role @default(USER)
}
```

### 常用命令

```bash
# 初始化 Prisma（生成 prisma.config.ts 和 schema.prisma）
npx prisma init

# 创建新迁移（对比 schema 与数据库差异，生成 SQL）
npx prisma migrate dev --name init

# 应用迁移到数据库
npx prisma migrate deploy

# 同步 schema（仅开发环境，不生成迁移文件）
npx prisma db push

# 生成 Prisma Client
npx prisma generate

# 运行种子数据
npx prisma db seed

# 打开 Prisma Studio（可视化数据库客户端）
npx prisma studio
```

### PostgreSQL Schema 支持

项目使用非 `public` schema（如 `lixiangpai`），配置方式：

1. `DATABASE_URL` 中指定 `schema` 参数：
   ```
   DATABASE_URL="postgresql://user:pass@localhost:5432/db?schema=lixiangpai"
   ```

2. `prisma.ts` 中从 URL 解析 schema 并配置 `search_path`：
   ```typescript
   const schema = getSchemaFromUrl(process.env.DATABASE_URL) // 正则：/[?&]schema=([^&]+)/
   const pool = new Pool({
     connectionString: process.env.DATABASE_URL,
     options: `-c search_path=${schema}`,
   })
   const adapter = new PrismaPg(connectionString, { schema })
   ```

3. 种子数据中使用原始 SQL 时，需用 `"schema"."Table"` 格式引用：
   ```typescript
   await prisma.$executeRawUnsafe(
     `INSERT INTO "${schema}"."User" (...) VALUES (...)`
   )
   ```

## 环境配置

复制 `.env.example` 为 `.env` 并修改：

```bash
# 数据库连接（需包含 schema 参数）
DATABASE_URL="postgresql://用户名:密码@localhost:5432/数据库名?schema=lixiangpai"

# 应用地址
AUTH_ORIGIN="http://localhost:3000"

# JWT 密钥（生产环境务必修改）
AUTH_SECRET="your-secret-key-change-this-in-production"
```

## 部署方式

### 本地开发

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env

# 3. 执行数据库迁移
npx prisma migrate dev

# 4. 初始化种子数据（创建管理员账号）
npx prisma db seed

# 5. 启动开发服务器
npm run dev
# 访问 http://localhost:3000
```

### 生产构建与部署

```bash
# 1. 构建
npm run build
# 或静态生成
npm run generate

# 2. 预览构建结果
npm run preview
```

部署方式选择：
- **Node.js 服务器**：`npx nuxt start`（Nuxt 内置服务器）
- **静态托管**：`npm run generate` 后将 `.output/public` 部署到任意静态托管平台
- **Docker**：可基于 `node:20-alpine` 镜像构建，安装依赖后执行 `npx prisma migrate deploy && npx nuxt build && npx nuxt start`

### 部署清单

1. 配置生产环境变量（`DATABASE_URL`、`AUTH_SECRET`、`AUTH_ORIGIN`）
2. 执行数据库迁移 `npx prisma migrate deploy`
3. 构建项目 `npm run build`
4. 启动服务 `npm run preview` 或直接运行 `.output/server`

### 默认管理员账号

种子数据默认创建：
- 邮箱：`admin@admin.com`
- 密码：`admin123`
- 姓名：`Admin`
- 角色：`ADMIN`

## API 接口一览

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|------|
| POST | `/api/auth/login` | 用户登录 | 否 |
| POST | `/api/auth/register` | 用户注册 | 否 |
| POST | `/api/auth/logout` | 退出登录 | 否 |
| GET | `/api/auth/me` | 获取当前用户 | 是 |
| POST | `/api/auth/forgot-password` | 发送重置密码链接（防枚举） | 否 |
| POST | `/api/auth/reset-password` | 重置密码（事务更新） | 否 |
| GET | `/api/settings` | 获取全部设置 | 是 |
| POST | `/api/settings` | 创建/更新设置 | 是 |
| GET | `/api/settings/:key` | 获取单个设置 | 是 |
| DELETE | `/api/settings/:key` | 删除设置 | 是 |
| POST | `/api/cad/generate` | 文字 / 图片生成 3D、超长分析自动精简、现有模型材质编辑 | 是 |

## CAD 回归验证

在项目根目录使用 Node.js 26.4.0 执行：

```bash
# 自动精简、生成接口、DXF 导出和材质回归
node --test tests/cad-compaction.test.mjs tests/cad-export.test.mjs tests/cad-materials.test.mjs

# Nuxt 生产构建
npm run build
```

测试覆盖 12000 字边界、完整分段与代理对、模型异常及超长输出重试、200000 字安全上限、鉴权与材质模式兼容，以及图片输入的精简衔接。模型网络请求使用模拟响应，不访问真实账户、数据库或模型服务。

浏览器隔离预览（两个命令分别启动不同页面，按需选择）：

```bash
# 独立 CAD 页面：http://127.0.0.1:4178/
node tests/cad-materials-preview.mjs

# 工作台 3D 弹窗：http://127.0.0.1:4179/
node tests/cad-materials-preview.mjs --workspace
```

隔离预览加载真实页面、Viewer 和精简算法，使用模拟任务与模型响应。工作台可验证生成与导出、关闭重开缓存、迟到响应隔离、失败保留原模型、超长分析自动精简及截图回填。可通过浏览器的 `window.__cadTest` 注入延迟、错误和精简响应。

模拟测试与构建不代表真实大模型摘要质量已验证，也不等同于全量类型检查通过；真实模型的关键尺寸保留情况仍需结合实际图纸核对。

## TypeScript 配置

项目使用 Nuxt 4 自动生成的 TypeScript 配置，通过 `tsconfig.json` 引用：

```json
{
  "files": [],
  "references": [
    { "path": "./.nuxt/tsconfig.app.json" },
    { "path": "./.nuxt/tsconfig.server.json" },
    { "path": "./.nuxt/tsconfig.shared.json" },
    { "path": "./.nuxt/tsconfig.node.json" }
  ]
}
```

这种方式确保类型定义与 Nuxt 运行时环境完全同步。
