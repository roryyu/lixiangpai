# text-to-cad 分析与 Node.js 重写可行性评估

> 目标仓库：https://github.com/earthtojake/text-to-cad
> 迁移目标工程：`lixiangpai`（Nuxt 4 + Node.js 26 + Prisma + PostgreSQL + OpenAI）
> 结论先行：**架构思想与 90% 的代码可以纯 Node.js 重写**，唯一的硬骨头是 **BREP/STEP 几何内核**（原仓库依赖 OpenCascade）。本文给出分层拆解、内核替换选型和落地方案。

---

## 一、text-to-cad 到底是什么

首先要纠正一个直觉：`text-to-cad` **不是一个「输入文字 → 输出 3D 模型」的运行时服务/库**，而是一个 **"给 AI Agent 使用的技能（Agent Skills）库"**。它本身不含模型推理权重，也不含传统意义上的 text-to-3D 神经网络。

它的真实工作链路是：

```
自然语言需求 / 图片
      │
      ▼
LLM Agent 读取 SKILL.md + references/*.md（领域知识提示词）
      │
      ▼
LLM 生成一段"参数化 CAD 建模脚本"（Python，使用 cadgen / build123d DSL）
      │
      ▼
执行 `python model.py`
      │
      ▼
cadgen 构建管线（底层 = OCP，即 OpenCascade 的 Python 绑定）真正算出几何
      │
      ▼
产出 STEP / STL / 3MF / GLB / DXF / URDF / SRDF / SDF 文件
      │
      ▼
浏览器 Viewer（React + Three.js）预览 + Playwright/Chromium 截图做视觉自检
```

也就是说：**"text-to-cad" 的智能来自 LLM 写代码，几何的正确性来自 OpenCascade 内核**。它把"文本转 CAD"问题转化成了"文本转建模脚本，脚本转几何"两段式，规避了直接训练 text-to-BREP 模型的需要。

### 仓库结构（约 2286 个文件）

| 目录 | 语言 | 作用 |
|------|------|------|
| `skills/` | Markdown + Python | 11 个技能：cad / cad-viewer / dxf / urdf / srdf / sdf / step-parts / sendcutsend / dfam-check / gcode / bambu-labs。每个 = `SKILL.md`（给 Agent 的指令）+ `references/*.md`（知识）+ `scripts/*.py` |
| `packages/cadgen-js/` | JavaScript（~120+ 文件） | **纯 JS 的渲染/显示层**：Three.js 场景、动画时钟、运动学 runtime、DXF 预览网格、STEP 树解析等 |
| `apps/viewer/` | React + Three.js（227 js + 32 jsx） | 浏览器 CAD 查看器，`three@0.186`，通过 `/__cad/*` 路由向后端取数据 |
| `apps/docs/` | Next.js + TS | 文档站 + hero 3D 渲染 |
| `models/` | 856 个 `.py` + json/step/dxf | fixture 语料库（示例模型脚本），非运行必需 |
| **`cadgen`（外部 pip 包 0.6.5）** | **Python + C++（OCP）** | **真正的 BREP/STEP 几何内核 + build123d DSL + 构建缓存 store + viewer 后端 + 截图工具。不在本仓库内，是 pip 依赖** |

> 关键点：本仓库里"能跑几何运算"的部分 = **`cadgen` 这个外部 pip 包（OCP/OpenCascade）**；仓库自带的 `cadgen-js` 只负责**显示**，不负责**建模计算**。

---

## 二、实现逻辑分层拆解

按可迁移性把系统拆成 5 层：

### L1 技能/提示层（Markdown，纯文本）
- `skills/*/SKILL.md` 与 `references/*.md` 是写给 LLM 的结构化提示词与领域知识（build123d 建模规范、STEP 输出契约、修复回路、快照评审、单位/公差约定等）。
- **与语言无关，直接照搬即可**，最多把示例从 Python 语法改写成目标 DSL 语法。

### L2 生成层（LLM 调用）
- 本质是「prompt → 生成一段建模脚本」。原仓库把这段交给 Agent 运行环境（Codex / Claude Code / Grok）。
- **Node.js 完全等价**：用 `openai` SDK 发系统提示 + 用户请求，让模型产出结构化脚本即可。lixiangpai 已有 `server/utils/recognition/qwen.ts`、`PromptSetting`/`AIConversation` 模型，这一层几乎是现成的。

### L3 建模 DSL / 内核层（**迁移难点**）
- `cadgen` 暴露 build123d 风格 API（`Box`/`Cylinder`/`Extrude`/布尔运算/圆角…），底层调用 OpenCascade 求真实 BREP，写出 STEP/STL/GLB。
- 这一层是**唯一强绑定 Python/C++ 的部分**，也是"完全 Node.js 重写"能否成立的决定性因素（详见第三节）。

### L4 显示/预览层（Three.js，已是 JS）
- `packages/cadgen-js` + `apps/viewer` 就是浏览器 Three.js 代码。
- **技术栈天然兼容**，可移植进 Nuxt/Vue（组件从 React 改写为 Vue SFC，渲染逻辑与 `cadgen-js` 的几何/网格处理逻辑几乎原样复用）。STL/GLB 可前端直接加载；STEP 需要转成网格（后端或 wasm 端 tessellation）。

### L5 校验/导出/周边（脚本 + CLI）
- 快照自检：Playwright + Chromium —— **Node.js 原生支持**（`playwright` 有官方 Node 包）。
- DXF：`ezdxf`（Python）→ Node 有 `dxf-writer` / 直接产出 DXF 文本（DXF 是明文格式，LLM 直出也可）。
- URDF/SRDF/SDF：**纯 XML/文本生成，不需要任何内核**，LLM 直写 + zod 校验即可，100% 可 Node 化。
- G-code：调外部切片器 CLI（Prusa/Orca）—— 语言无关。
- step-parts：调在线 API 下载标准件 —— HTTP 即可。

**小结：L1、L2、L4、L5 都可无损或低成本迁到 Node.js；决策全压在 L3。**

---

## 三、L3 几何内核的 Node.js 替换选型（核心）

要在 Node.js 里"完全重写"，必须回答：**用什么算 BREP/布尔运算/导出 STEP？** 四条现实路线：

| 方案 | 内核 | STEP I/O | 成熟度 | 代价/风险 |
|------|------|----------|--------|-----------|
| **A. opencascade.js** | OpenCascade 编译成 WASM（与 cadgen 同一内核） | ✅ 读写 STEP/IGES | 中 | 包体巨大（~50–120MB wasm），API 面窄（大量 OCCT 类未绑定），build123d 高层 DSL 需自行封装；Node 端跑 WASM 可行但调优成本高 |
| **B. Manifold (manifold-geometry)** | 高性能流形网格内核（WASM/原生） | ❌ 仅网格，无原生 STEP | 高（鲁棒布尔） | 是 **mesh/CSG** 不是 BREP；导不出精确 STEP 曲面模型，只适合 STL/3MF/GLB 网格产物 |
| **C. @jscad/modeling** | 纯 JS CSG，网格 | ❌ 无 STEP | 高 | 纯 JS 无 wasm、最好嵌；但同为 mesh 路线，且 API 与 build123d 差异大 |
| **D. 保留子进程 Python 内核**（非"纯重写"） | 直接 `cadgen` | ✅ 完整 | 最高 | 违背"完全 Node.js"目标；作为兜底/降级可选 |

### 选型建议（按产物类型分工，而非二选一）

text-to-cad 的产物本来就分两类，Node 重写应顺着这条缝切：

1. **精确工程模型（STEP/BREP）**：若要 100% 保真 STEP → 只能走 **方案 A（opencascade.js WASM）**，并自己封装一层"简化版 build123d DSL"（Box/Cylinder/Sphere/Extrude/Revolve/布尔/fillet）。工作量最大。
2. **可打印/可视化网格（STL/3MF/GLB）**：走 **方案 B（Manifold）**，鲁棒性最好、体积可控，覆盖 3D 打印与预览主用途。
3. **文本类产物（DXF/URDF/SRDF/SDF）**：**不需要内核**，LLM 直出文本 + zod/规则校验即可（这些恰恰是原仓库一半以上的技能）。

> 现实判断：如果业务只服务「预览 + 3D 打印（GLB/STL）」，**纯 Node.js 重写完全可行且干净**（Manifold + Three.js + 文本直出）。
> 如果必须产出「精确 STEP 供工程/CAM 使用」，纯 Node.js 只能靠 opencascade.js，属于**可行但吃力**，需评估该内核的 API 缺口。

---

## 四、迁移到 lixiangpai 的落地架构

lixiangpai 已具备极佳的宿主条件：`openai` SDK、异步 `Task`/`Record` 状态机（PENDING/RUNNING/COMPLETED/FAILED）、图片上传→OSS、视觉识别（qwen）与 OCR、`PromptSetting`/`AIConversation`、workspace 页面流。**"文本/图片 → CAD" 本质是现有"图片识别任务流"的同构扩展。**

### 目标目录结构（新增，沿用 Nuxt 约定）

```
server/
├── utils/cad/
│   ├── kernel.ts          # L3：封装 Manifold / opencascade.js，暴露 box/cylinder/boolean/export
│   ├── dsl.ts             # 受限建模 DSL 解释器（把 LLM 输出的 JSON/脚本 → 内核调用）
│   ├── prompts.ts         # L1：cad/dxf/urdf… 系统提示词（从 SKILL.md/references 移植）
│   ├── generate.ts        # L2：调 openai 产出建模计划
│   └── export.ts          # STEP/STL/GLB/DXF 落盘 + 上传 OSS
├── api/cad/
│   ├── generate.post.ts   # POST /api/cad/generate  文本→模型（建 Task，异步跑）
│   ├── [id].get.ts        # 轮询产物状态
│   └── preview/[id].get.ts# 提供 GLB/网格给前端 viewer
app/
├── pages/cad.vue          # 文本→CAD 工作台页（仿现有 workspace.vue）
└── components/cad/Viewer.vue   # L4：Three.js 查看器（Vue 封装，加载 GLB/STL）
prisma/schema.prisma       # 扩展 Task 复用，或新增 CadModel 表
```

### DSL 层是关键设计（决定"重写"成不成）

不要让 LLM 直接吐可执行 JS（安全 + 稳定都差）。让它吐**受约束的建模指令 JSON**，Node 端解释执行：

```jsonc
// LLM 输出（受提示词约束的 schema）
{
  "units": "mm",
  "parts": [
    { "op": "box", "size": [40, 10, 6], "label": "plate" },
    { "op": "cylinder", "radius": 2.5, "height": 6, "translate": [8, 5, 0], "label": "hole" }
  ],
  "boolean": [{ "op": "subtract", "base": "plate", "tools": ["hole"] }],
  "export": ["stl", "glb"]        // 走 Manifold；若内核选 opencascade.js 才允许 "step"
}
```
`dsl.ts` 用 zod 校验该 JSON → 映射到 kernel 调用 → 导出。这样把"任意代码执行"降级为"受限解释器"，既安全又可控，也便于"修复回路"（把内核报错回灌给 LLM 重试，对应原仓库 repair-loop.md）。

### 各技能迁移难度评估

| 技能 | Node 重写难度 | 说明 |
|------|--------------|------|
| urdf / srdf / sdf | ★☆☆☆☆ 极易 | XML/文本直出 + zod 校验，无内核 |
| dxf | ★★☆☆☆ 易 | 2D 明文格式，`dxf-writer` 或直出 |
| cad-viewer（预览） | ★★☆☆☆ 易 | React→Vue 改写，Three.js 逻辑与 `cadgen-js` 复用 |
| cad（生成 STL/3MF/GLB 网格） | ★★★☆☆ 中 | Manifold 内核 + DSL 层，主用途可覆盖 |
| cad（生成精确 STEP/BREP） | ★★★★★ 难 | 只能 opencascade.js，API 缺口 + wasm 调优 |
| dfam-check | ★★★☆☆ 中 | 对网格做壁厚/悬垂分析，需自写网格几何算法 |
| gcode / bambu-labs | ★★★★☆☆ 中难 | 依赖外部切片器 CLI，语言无关但集成环境复杂 |
| step-parts | ★★☆☆☆ 易 | 在线 API 下载标准件 |
| sendcutsend | ★★☆☆☆ 易 | DXF/STEP 规则校验，读文件+规则 |

---

## 五、分阶段实施建议

1. **阶段一（1 周内可验证）——纯文本类技能**：迁 urdf/sdf/dxf（无内核），复用现有 openai + Task 流，跑通「文本→文件→预览」。证明架构成立。
2. **阶段二——网格 3D**：接入 Manifold，实现 `dsl.ts`（受限建模 JSON）+ GLB/STL 导出 + Vue Three.js 查看器。覆盖绝大多数"能看能打印"需求。
3. **阶段三——STEP 精确模型（可选/按需）**：若确有工程/CAM 需求，再评估引入 opencascade.js；否则明确以 GLB/STL 为交付边界。
4. **阶段四——校验回路**：接入 `playwright`（Node 版）做截图自检 + 内核报错回灌重试，复刻原仓库的 repair-loop。

---

## 六、结论

- **可行（推荐路径）**：把 text-to-cad 的"LLM 写受限建模指令 → 内核执行 → 导出 → 浏览器预览"这套**思想**完整搬到 Node.js，产物以 **GLB/STL/3MF 网格 + DXF/URDF/SDF 文本** 为主。技术栈与 lixiangpai 高度契合（openai、Task 状态机、OSS、Three.js 前端），L1/L2/L4/L5 迁移成本低，是**干净、纯 Node、无 Python 依赖**的方案。
- **有代价（需权衡）**：唯一"完全对等"的难点是 **精确 STEP/BREP 输出**——纯 Node 下只能靠 `opencascade.js`（同一 OpenCascade 内核的 WASM 版），包体大、API 面窄，需自建 DSL 封装；若 STEP 非硬需求，建议直接以网格交付回避此坑。
- **不建议**：为了"看起来一样"而保留 Python 子进程跑 `cadgen`——那不算 Node.js 重写，只是外壳 Node 化，违背目标。

> 一句话：**架构照搬、显示层直接复用、文本类技能几乎白送；几何内核按"网格(Manifold) 优先、STEP(opencascade.js) 按需"分级替换，即可实现真正意义的完全 Node.js 重写。**

## 七、已接入的 DXF 下载功能

`/cad` 的 3D 预览区提供「保存 DXF」按钮。链路完全在浏览器内完成，不经过任何服务端接口或外部转换工具：

```text
当前模型的有效三角面 → 前端 trianglesToDxf → R2000 三维 DXF（3DFACE）→ Blob 直接下载
```

- 纯 JavaScript 实现（`shared/utils/cad-export.ts`），**无 Python、无 ODA、无第三方上传**；AutoCAD 等 CAD 软件可直接打开 `.dxf`，需要时再另存为 DWG。
- 导出保存模型几何位置、尺寸和单位，不含预览相机、居中位移、网格地面或坐标轴。Three.js 的 Y-up 转为 CAD Z-up：`(x, y, z) → (x, -z, y)`。
- 输出是三角面（3DFACE）网格，不是参数化实体或精确 B-Rep 曲面；近似精度取决于前端求值出的网格本身。
- 支持单位 `mm/cm/m/in/inch/ft`（大小写与空格会归一化，不支持的单位直接报错，不静默当作毫米），最多 10 万三角面，超出时提示简化模型。

### 验证方法与边界

在项目根目录使用 Node.js 26：

```bash
node --test tests/cad-export.test.mjs
npm run build
```

测试覆盖索引/非索引网格与 `drawRange`、真实 CSG 差集坐标往返、单位与坐标转换、`$EXTMIN/$EXTMAX` 包围盒、句柄唯一性及 DXF 头尾结构。这些只验证文本格式正确，仍建议安装后在目标 CAD 软件里核对实际打开效果。
