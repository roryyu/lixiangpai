# Code Review Report

**项目**: lixiangpai (理想派)
**技术栈**: Nuxt 4 + Prisma 7 + PostgreSQL + Element Plus + 阿里云 OSS + Qwen-VL
**审查日期**: 2026-07-04
**审查范围**: 全项目代码审查

---

## 项目概述

本项目是一个基于 Nuxt 4 的全栈应用，用于室内空间规划/CAD 图纸识别。核心流程为：用户上传图片 -> OCR + Qwen-VL 视觉识别 -> 结构化数据输出 -> AI 生成效果图。使用 Prisma 7 作为 ORM，阿里云 OSS 存储文件，JWT 认证。

## 架构流程图

```mermaid
flowchart LR
    A[用户上传图片] --> B[创建Task任务]
    B --> C[图片预处理<br/>灰度/二值化/旋转]
    C --> D[OCR文字提取<br/>Tesseract 4方向]
    D --> E[Qwen-VL分块识别]
    E --> F[两轮精化识别]
    F --> G[后处理结构化]
    G --> H[Qwen生成效果图]
    H --> I[上传OSS保存]
    I --> J[更新Task完成]

    style A fill:#bbdefb,color:#0d47a1
    style B fill:#c8e6c9,color:#1a5e20
    style E fill:#fff3e0,color:#e65100
    style F fill:#fff3e0,color:#e65100
    style H fill:#f3e5f5,color:#7b1fa2
    style I fill:#c8e6c9,color:#1a5e20
    style J fill:#c8e6c9,color:#1a5e20
```

```mermaid
sequenceDiagram
    participant C as 前端
    participant API as Nuxt API
    participant DB as PostgreSQL
    participant OSS as 阿里云OSS
    participant QW as Qwen-VL

    C->>API: POST /tasks/start (FormData)
    API->>DB: 创建 Task(PENDING)
    API-->>C: 返回 taskId
    Note over API,QW: 异步执行 executeRecognitionTask
    API->>QW: callQwenDoc 生成任务名
    API->>QW: 图片预处理 + OCR + 分块识别
    QW-->>API: 结构化数据
    API->>QW: callQwenDoc 设计分析
    API->>QW: generateImage 效果图
    QW-->>API: 图片URL
    API->>OSS: uploadToOSSbyUrl 效果图
    API->>OSS: uploadToOSSAndSaveRecord 原图
    API->>DB: 更新 Task(COMPLETED)
    C->>API: GET /tasks/:id (轮询)
    API->>DB: 查询Task状态
    API-->>C: 返回结果
```

---

## 问题汇总

| No. | 严重程度 | 问题标题 | 文件 | 行号 |
|-----|---------|---------|------|------|
| 1 | **严重** | `.env.example` 暴露真实数据库凭据 | `.env.example` | L2 |
| 2 | **严重** | JWT 签名密钥存在硬编码 fallback | `server/utils/auth.ts` | L4 |
| 3 | **严重** | 路径遍历漏洞 - 可读取服务器任意文件 | `server/api/image/to-base64.post.ts` | L6-17 |
| 4 | **严重** | Webhook 接口无身份认证 | `server/api/tasks/[id]/webhook.post.ts` | L1-63 |
| 5 | **严重** | OSS 预签名 URL 接口无身份认证 | `server/api/oss/presigned.get.ts` | L1-18 |
| 6 | **高** | `deleteFiles` 调用不存在的函数 | `server/utils/oss.ts` | L263 |
| 7 | **高** | History API 引用已删除的数据模型 | `server/api/history/index.get.ts` | L14 |
| 8 | **高** | 注册接口存在竞态条件 (TOCTOU) | `server/api/auth/register.post.ts` | L15-48 |
| 9 | **高** | `buildRefinePrompt` 参数类型不匹配 | `server/utils/recognition/vision.ts` | L90 |
| 10 | **中** | 约 700 行未使用的硬编码测试数据 | `server/utils/recognition/index.ts` | L15-710 |
| 11 | **中** | 临时文件未清理导致磁盘泄漏 | `server/utils/upload.ts` | L135-138 |
| 12 | **低** | 调试 console.log 残留 | 多个文件 | - |

---

## 详细问题说明

### 1. `.env.example` 暴露真实数据库凭据 [严重]

**文件**: [.env.example](file:///Users/roryyu/Downloads/code/mycode/lixiangpai/.env.example#L2)

`.env.example` 中包含真实的数据库用户名和密码 `sheliming:Aa123456`，而非占位符。该文件通常会被提交到版本控制，导致数据库凭据泄露。

**建议**: 替换为占位符值，如 `postgresql://user:password@localhost:5432/dbname?schema=xxx`。同时确认 `.env` 文件已在 `.gitignore` 中。

---

### 2. JWT 签名密钥存在硬编码 fallback [严重]

**文件**: [auth.ts](file:///Users/roryyu/Downloads/code/mycode/lixiangpai/server/utils/auth.ts#L4)

```typescript
const SECRET = process.env.AUTH_SECRET || 'fallback-secret'
```

当 `AUTH_SECRET` 环境变量未设置时，使用已知的 `'fallback-secret'` 作为 JWT 签名密钥。攻击者可以用该密钥伪造任意用户的 JWT token，获取未授权访问。

**建议**: 移除 fallback，在缺少 `AUTH_SECRET` 时直接抛出错误阻止启动：
```typescript
const SECRET = process.env.AUTH_SECRET
if (!SECRET) throw new Error('AUTH_SECRET 环境变量未设置')
```

---

### 3. 路径遍历漏洞 - 可读取服务器任意文件 [严重]

**文件**: [to-base64.post.ts](file:///Users/roryyu/Downloads/code/mycode/lixiangpai/server/api/image/to-base64.post.ts#L6-L17)

```typescript
const imagePath = body.path as string
const absolutePath = path.resolve(imagePath)
const imageBuffer = await fs.readFile(absolutePath)
```

接口接受用户提供的任意路径参数，直接用 `path.resolve` 解析后读取文件，无任何路径白名单或目录限制校验。攻击者可传入 `../../etc/passwd` 等路径读取服务器上的任意文件。此外，该接口也没有身份认证。

**建议**: 
- 添加身份认证
- 限制可读路径必须在 `UPLOAD_DIR` 或 `RESULT_DIR` 内
- 使用 `path.resolve` 后检查路径前缀

---

### 4. Webhook 接口无身份认证 [严重]

**文件**: [webhook.post.ts](file:///Users/roryyu/Downloads/code/mycode/lixiangpai/server/api/tasks/%5Bid%5D/webhook.post.ts)

该接口允许任何人通过 POST 请求修改任意任务的状态、进度、输出数据等字段，无任何身份验证或签名校验机制。

**建议**: 至少添加一个共享密钥 (webhook secret) 进行签名验证，或使用 API Token 认证。

---

### 5. OSS 预签名 URL 接口无身份认证 [严重]

**文件**: [presigned.get.ts](file:///Users/roryyu/Downloads/code/mycode/lixiangpai/server/api/oss/presigned.get.ts)

任何人只需提供 `bucket` 和 `osskey` 参数，即可获取 OSS 文件的临时访问 URL，无需登录。这可能导致未授权访问存储的文件。

**建议**: 添加 `getUserFromToken` 认证检查。

---

### 6. `deleteFiles` 调用不存在的函数 [高]

**文件**: [oss.ts](file:///Users/roryyu/Downloads/code/mycode/lixiangpai/server/utils/oss.ts#L257-L271)

```typescript
export async function deleteFiles(bucket: string, keys: string[]) {
  // ...
  await deleteFile({ bucket, key })  // L263: deleteFile 未定义
  // ...
}
```

文件中定义的删除函数名为 `deleteFileOSS`（L239），但 `deleteFiles` 内调用的是 `deleteFile`，该函数不存在。调用 `deleteFiles` 时会抛出 `ReferenceError`。

**建议**: 将 `deleteFile` 改为 `deleteFileOSS`。

---

### 7. History API 引用已删除的数据模型 [高]

**文件**: [history/index.get.ts](file:///Users/roryyu/Downloads/code/mycode/lixiangpai/server/api/history/index.get.ts#L14)

```typescript
const histories = await prisma.history.findMany({ ... })
```

`History` 模型已在迁移 `20260702120811_replace_history_with_task` 中被删除并替换为 `Task` 模型。该 API 在运行时会因 Prisma 找不到 `history` 表而报错。

**建议**: 删除该 API 文件，或将其改为查询 `Task` 模型（与 `/api/tasks` 合并）。

---

### 8. 注册接口存在竞态条件 (TOCTOU) [高]

**文件**: [register.post.ts](file:///Users/roryyu/Downloads/code/mycode/lixiangpai/server/api/auth/register.post.ts#L15-L48)

邮箱和手机号的唯一性检查（`findUnique`）与用户创建（`create`）之间没有使用事务包裹。在高并发场景下，两个请求可能同时通过唯一性检查，然后都成功创建用户，导致数据重复。

**建议**: 使用 `prisma.$transaction` 将检查和创建包裹在一个事务中，或依赖数据库层面的唯一约束作为兜底（schema 中 email 已有 `@unique`，phone 也有，所以数据库层面会阻止，但应用层会收到不友好的错误信息）。

---

### 9. `buildRefinePrompt` 参数类型不匹配 [高]

**文件**: [vision.ts](file:///Users/roryyu/Downloads/code/mycode/lixiangpai/server/utils/recognition/vision.ts#L90)

```typescript
const refinePrompt = buildRefinePrompt(ocrResult, roughResult+"\n\r"+stepResult)
```

`buildRefinePrompt` 的第二个参数期望 `RoughResult` 对象类型（[qwen.ts L206](file:///Users/roryyu/Downloads/code/mycode/lixiangpai/server/utils/recognition/qwen.ts#L206)），但此处传入的是字符串拼接结果。在函数内部会对参数执行 `JSON.stringify`，导致字符串被二次转义，prompt 内容异常，影响识别质量。

**建议**: 将 stepResult 合并到 roughResult 对象中，而非字符串拼接。

---

### 10. 约 700 行未使用的硬编码测试数据 [中]

**文件**: [recognition/index.ts](file:///Users/roryyu/Downloads/code/mycode/lixiangpai/server/utils/recognition/index.ts#L15-L710)

`testData` 变量包含约 695 行的硬编码 JSON 数据，在整个代码中从未被引用或使用。这严重增加了文件体积和加载时间，也影响代码可维护性。

**建议**: 删除 `testData` 变量，如需保留测试数据应放在独立的测试文件中。

---

### 11. 临时文件未清理导致磁盘泄漏 [中]

**文件**: [upload.ts](file:///Users/roryyu/Downloads/code/mycode/lixiangpai/server/utils/upload.ts#L135-L138)

```typescript
//删除RESULT_DIR下相关的文件binary，enhanced，preprocessed文件
console.log(path.join(RESULT_DIR, `${baseName}.binary${ext}`))
console.log(path.join(RESULT_DIR, `${baseName}.enhanced${ext}`))
console.log(path.join(RESULT_DIR, `${baseName}.preprocessed${ext}`))
```

注释说明需要删除临时文件，但实际代码仅用 `console.log` 打印了路径，没有执行删除。每次任务执行都会在 `results/` 目录下遗留 `.binary.png`、`.enhanced.png`、`.preprocessed.png` 等临时文件，长期运行将导致磁盘空间泄漏。

**建议**: 将 `console.log` 替换为 `deleteFile(path.join(RESULT_DIR, ...))` 调用。

---

### 12. 调试 console.log 残留 [低]

多个文件中存在调试用的 `console.log`，应清理：

| 文件 | 行号 | 内容 |
|------|------|------|
| [start.post.ts](file:///Users/roryyu/Downloads/code/mycode/lixiangpai/server/api/tasks/start.post.ts#L77) | L77 | `console.log('@@@@@@@@@@@@@@@taskid',task.id)` |
| [qwen.ts](file:///Users/roryyu/Downloads/code/mycode/lixiangpai/server/utils/recognition/qwen.ts#L322) | L322 | `console.log("@@@@...@@@@生成图片地址:", ...)` |

**建议**: 移除调试日志，或使用项目统一的日志工具。

---

## 审查总结

| 严重程度 | 数量 |
|---------|------|
| 严重 | 5 |
| 高 | 4 |
| 中 | 2 |
| 低 | 1 |
| **合计** | **12** |

**重点关注**: 本次审查发现 5 个严重安全问题，其中路径遍历漏洞（#3）和 JWT fallback 密钥（#2）可被直接利用。建议优先修复所有严重和高优先级问题后再部署到生产环境。
