import { z } from 'zod'

/**
 * CAD 建模 DSL —— 树形 CSG（构造实体几何）描述。
 *
 * 设计原则：LLM 只输出「受约束的结构化 JSON」，服务端用 zod 校验后交给
 * 前端 Three.js + three-bvh-csg 解释执行，从而把「任意代码执行」降级为
 * 「受限解释器」，既安全又便于错误回灌重试。
 *
 * 一个模型是一棵节点树：
 *  - 叶子 = 基础图元（box / cylinder / sphere / cone / torus）
 *  - 内部节点 = 布尔运算（union / subtract / intersect），children 从左到右折叠
 */

export type CadVec3 = [number, number, number]

export interface CadTransform {
  /** 平移 [x, y, z]，单位与 model.units 一致（默认 mm） */
  translate?: CadVec3
  /** 旋转 [rx, ry, rz]，单位为「度」，按 XYZ 顺序 */
  rotate?: CadVec3
  /** 缩放 [sx, sy, sz] */
  scale?: CadVec3
}

export type CadPrimitiveKind = 'box' | 'cylinder' | 'sphere' | 'cone' | 'torus'

export interface CadPrimitive {
  kind: CadPrimitiveKind
  /**
   * 图元尺寸参数（键值随 kind 变化）：
   *  box      -> { w, h, d }
   *  cylinder -> { radius, height } 或 { radiusTop, radiusBottom, height }
   *  sphere   -> { radius }
   *  cone     -> { radius, height }
   *  torus    -> { radius, tube }
   */
  size: Record<string, number>
  transform?: CadTransform
  color?: string
}

export type CadBooleanKind = 'union' | 'subtract' | 'intersect'

export interface CadBoolean {
  kind: CadBooleanKind
  /** 至少 2 个子节点，从左到右依次折叠 */
  children: CadNode[]
  color?: string
}

export type CadNode = CadPrimitive | CadBoolean

export interface CadModel {
  units: string
  title?: string
  summary?: string
  model: CadNode
}

const vec3Schema = z.tuple([z.number(), z.number(), z.number()])

const transformSchema: z.ZodType<CadTransform> = z.object({
  translate: vec3Schema.optional(),
  rotate: vec3Schema.optional(),
  scale: vec3Schema.optional(),
})

const primitiveSchema: z.ZodType<CadPrimitive> = z.object({
  kind: z.enum(['box', 'cylinder', 'sphere', 'cone', 'torus']),
  size: z.record(z.string(), z.number()),
  transform: transformSchema.optional(),
  color: z.string().optional(),
})

const booleanSchema: z.ZodType<CadBoolean> = z.object({
  kind: z.enum(['union', 'subtract', 'intersect']),
  children: z.lazy(() => z.array(nodeSchema)).refine((arr) => arr.length >= 2, {
    message: 'children 至少需要 2 个节点',
  }),
  color: z.string().optional(),
})

export const nodeSchema: z.ZodType<CadNode> = z.union([primitiveSchema, booleanSchema])

export const cadModelSchema: z.ZodType<CadModel> = z.object({
  units: z.string().default('mm'),
  title: z.string().optional(),
  summary: z.string().optional(),
  model: nodeSchema,
})

/** 判断节点是否为布尔运算节点 */
export function isCadBoolean(node: CadNode): node is CadBoolean {
  return node.kind === 'union' || node.kind === 'subtract' || node.kind === 'intersect'
}
