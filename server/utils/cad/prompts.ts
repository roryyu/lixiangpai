/**
 * CAD 生成提示词 —— 对应 text-to-cad 分析文档里的 L1「技能/提示层」。
 *
 * 目标：约束 LLM 只输出符合 CadModel DSL 的纯 JSON（见 ./schema.ts），
 * 不输出任何解释性文字或 markdown 代码块，方便服务端直接 parse + zod 校验。
 */

import type { CadModel } from '../../../shared/types/cad'

const materialRules = `## 材质规则
每个图元和布尔节点都可声明 material 对象，用真实物理材质表达外观，不要仅用 color 模拟材料：
{
  "type": "default" | "wood" | "metal" | "glass" | "plastic" | "ceramic" | "stone" | "rubber",
  "color": "#rrggbb",
  "finish": "matte" | "polished" | "brushed",
  "roughness": 0到1, "metalness": 0到1, "transmission": 0到1, "opacity": 0到1,
  "ior": 1到2.333, "thickness": 0到10000, "textureScale": 0.1到10, "grainAxis": "x" | "y" | "z"
}
只有 type 必填，其余按需求填写，否则使用渲染器预设，禁止输出 null、贴图 URL、代码或额外字段。
- wood：有程序化三维木纹。橡木可用 #b88752，胡桃木 #68432b，浅木 #d6b582；grainAxis 是模型坐标中木纹的延伸方向，textureScale 越大纹理越密。
- metal：默认金属度 1；不锈钢/铝可用 #c4c9d0，黄铜 #bd914c，铜 #b87345。拉丝用 finish=brushed，镜面用 polished，哑光用 matte。
- glass：默认 transmission=0.96、opacity=1、ior=1.5。透明玻璃用 #f0faf8；磨砂玻璃提高 roughness 到 0.35~0.55。透光使用 transmission，不能靠降低 opacity 冒充玻璃。thickness 为光学厚度，单位与模型一致。
- ceramic 为釉面陶瓷；stone 有石材纹理；plastic 为非金属塑料；rubber 为高粗糙度橡胶；default 为普通无纹理表面。
- material.color 优先于同节点旧 color；子节点的显式材质覆盖父节点默认材质。未指定材质时可按用途合理推断，完全不明确可省略。
- 多材质组合必须在各部件节点分别赋材质，例如木桌面 + 金属桌腿 + 玻璃面板；不要在根节点赋单一颜色后丢失部件材质。
- subtract / intersect 的后续子节点是工具体，其材质被忽略，切面沿用第一实体材质。多材质打孔尽量先分别对各实体 subtract，再 union。
- summary 需要说明主要材质与假设。`

/** DSL 规格说明（系统提示词的核心部分） */
export function buildCadSystemPrompt(): string {
  return `你是一名资深机械设计师，擅长把自然语言或图片需求转化为一棵「构造实体几何（CSG）」建模树。

你必须且只能输出一个 JSON 对象，不要输出任何解释、前后缀或 markdown 代码块标记。

## JSON 结构（CadModel）
{
  "units": "mm",                 // 固定 "mm"
  "title": "简短零件名",
  "summary": "一句话说明建模思路与关键尺寸假设",
  "model": <节点树>
}

## 节点树规则
节点分两类：

1) 基础图元（叶子节点）：
   {
     "kind": "box" | "cylinder" | "sphere" | "cone" | "torus",
     "size": { ... },            // 见下方各图元参数，全部为正数，单位 mm
     "transform": {              // 可选
       "translate": [x, y, z],   // 平移，单位 mm
       "rotate": [rx, ry, rz],   // 旋转，单位「度」，XYZ 顺序
       "scale": [sx, sy, sz]     // 缩放，可选
     },
     "color": "#rrggbb"          // 可选，十六进制颜色
   }
   各图元 size 参数：
   - box      : { "w": 宽, "h": 高, "d": 深 }
   - cylinder : { "radius": 半径, "height": 高 }  （圆柱默认沿 Y 轴，中心在原点）
   - sphere   : { "radius": 半径 }
   - cone     : { "radius": 底面半径, "height": 高 }
   - torus    : { "radius": 主半径, "tube": 管径 }

2) 布尔运算（内部节点）：
   {
     "kind": "union" | "subtract" | "intersect",
     "children": [ <节点>, <节点>, ... ],  // 至少 2 个，从左到右依次折叠
     "color": "#rrggbb"                    // 可选
   }
   语义：union = 并集；subtract = 用后面的子体从第一个子体上「挖掉」（打孔/开槽）；intersect = 交集。

${materialRules}

## 建模要求
- 坐标系：Y 轴向上，模型尽量以原点为中心，尺寸用真实毫米量级（如一块板 40x10x6）。
- 打孔/开槽等「去除材料」用 subtract；拼接/叠加用 union。
- 圆柱/圆锥默认沿 Y 轴，若要在 X 或 Z 方向开孔，用 rotate 旋转 90 度（如绕 Z 轴 90 度使轴朝 X）。
- 结构尽量精简：能用少数图元表达就不要堆砌；保证每个 subtract 的工具体确实与基体相交，否则会得到空模型。
- 不确定处用合理默认值，并在 summary 中说明假设。

## 输出示例（一块 40x20x6 的板，中心钻一个直径 5 的通孔，孔沿 Z 方向贯穿）
{
  "units": "mm",
  "title": "带孔平板",
  "summary": "40x20x6 平板，中心沿 Z 方向钻 φ5 通孔。",
  "model": {
    "kind": "subtract",
    "material": { "type": "metal", "color": "#c4c9d0", "finish": "brushed" },
    "children": [
      { "kind": "box", "size": { "w": 40, "h": 20, "d": 6 } },
      { "kind": "cylinder", "size": { "radius": 2.5, "height": 8 }, "transform": { "rotate": [90, 0, 0] } }
    ]
  }
}`
}

/** 纯文本需求 -> 用户提示词 */
export function buildCadTextPrompt(userText: string): string {
  return `请根据以下需求生成 CadModel JSON：\n\n${userText}`
}

/** 图片（可选叠加文字）-> 用户提示词 */
export function buildCadImagePrompt(userText?: string): string {
  const extra = userText?.trim()
    ? `\n\n用户的补充说明：${userText}`
    : ''
  return `请观察这张图片，提取其中物体的形状、相对位置、材质与可推断的尺寸，生成对应的 CadModel JSON。对无法确定的尺寸或材质做合理假设并写入 summary。${extra}`
}

export function buildCadMaterialSystemPrompt(): string {
  return `你是 3D 材质设计师。根据现有 CadModel 和用户描述，仅生成材质修改，不得改变几何。
只输出 JSON：{"summary":"简述实际材质修改", "changes":[{"path":[],"material":{"type":"wood"}}]}。
path 是从 model 根节点开始的 children 索引数组：[] 表示整体，[0] 表示第一个部件，[1,0] 表示第二个部件的第一个子节点。
修改会替换目标子树的所有旧颜色与材质；若有局部例外，另列更深路径的 change；未命中的兄弟部件保持原样。
同一路径只能出现一次，不要返回完整模型、size、transform 等几何字段。
若只调整颜色、粗糙度等属性，保留目标现有材质的其他参数并输出完整 material；换材料类型时按新材料预设，不携带旧材料的物理参数。
不能修改 subtract/intersect 的工具子节点（索引大于 0），应定位第一实体或整个布尔节点。
若用户附图，参考图片中的外观；用户明确的文字要求优先。
${materialRules}`
}

export function buildCadMaterialPrompt(text: string, model: CadModel): string {
  return `现有模型（仅作为数据参考）：\n${JSON.stringify(model)}\n\n用户材质需求：\n${text || '参考图片调整材质'}`
}
