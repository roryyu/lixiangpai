import { z } from 'zod'
import { CAD_MATERIAL_TYPES, isCadBoolean } from '../../../shared/types/cad'
import type { CadMaterial, CadTransform, CadPrimitive, CadBoolean, CadNode, CadModel } from '../../../shared/types/cad'

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

const unitInterval = z.number().min(0).max(1)
export const cadMaterialSchema: z.ZodType<CadMaterial> = z.object({
  type: z.enum(CAD_MATERIAL_TYPES),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, '材质颜色必须为 #rrggbb').optional(),
  finish: z.enum(['matte', 'polished', 'brushed']).optional(),
  roughness: unitInterval.optional(),
  metalness: unitInterval.optional(),
  transmission: unitInterval.optional(),
  opacity: unitInterval.optional(),
  ior: z.number().min(1).max(2.333).optional(),
  thickness: z.number().min(0).max(10000).optional(),
  textureScale: z.number().min(0.1).max(10).optional(),
  grainAxis: z.enum(['x', 'y', 'z']).optional(),
}).strict()

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
  material: cadMaterialSchema.optional(),
})

const booleanSchema: z.ZodType<CadBoolean> = z.object({
  kind: z.enum(['union', 'subtract', 'intersect']),
  children: z.lazy(() => z.array(nodeSchema)).refine((arr) => arr.length >= 2, {
    message: 'children 至少需要 2 个节点',
  }),
  color: z.string().optional(),
  material: cadMaterialSchema.optional(),
})

export const nodeSchema: z.ZodType<CadNode> = z.union([primitiveSchema, booleanSchema])

export const cadModelSchema: z.ZodType<CadModel> = z.preprocess((value, ctx) => {
  if (!value || typeof value !== 'object' || !('model' in value)) return value
  const stack: { node: unknown; depth: number }[] = [{ node: value.model, depth: 0 }]
  let count = 0
  while (stack.length) {
    const { node, depth } = stack.pop()!
    if (++count > 128 || depth > 16) {
      ctx.addIssue({ code: 'custom', message: '模型最多包含 128 个节点、16 层嵌套，请简化模型' })
      return z.NEVER
    }
    if (node && typeof node === 'object' && 'children' in node && Array.isArray(node.children)) {
      if (node.children.length > 128) {
        ctx.addIssue({ code: 'custom', message: '子节点数量过多，请简化模型' })
        return z.NEVER
      }
      node.children.forEach(child => stack.push({ node: child, depth: depth + 1 }))
    }
  }
  return value
}, z.object({
  units: z.string().default('mm'),
  title: z.string().optional(),
  summary: z.string().optional(),
  model: nodeSchema,
}))

export const cadMaterialEditSchema = z.object({
  summary: z.string().max(2000),
  changes: z.array(z.object({
    path: z.array(z.number().int().min(0)).max(16),
    material: cadMaterialSchema,
  }).strict()).min(1).max(64),
}).strict()

/** 材质编辑只接受节点路径和材质，不允许模型生成器改动几何结构。 */
export function applyCadMaterialEdit(model: CadModel, edit: z.infer<typeof cadMaterialEditSchema>): CadModel {
  const next = structuredClone(model)
  const clearAppearance = (node: CadNode) => {
    delete node.material
    delete node.color
    if (isCadBoolean(node)) node.children.forEach(clearAppearance)
  }
  // 先整体、后局部，使「整体木质，支架金属」的结果不依赖返回顺序。
  for (const change of [...edit.changes].sort((a, b) => a.path.length - b.path.length)) {
    let node = next.model
    for (const index of change.path) {
      if (!isCadBoolean(node) || !node.children[index]) {
        throw new Error(`材质目标不存在：model.children[${change.path.join('].children[')}]`)
      }
      if (node.kind !== 'union' && index > 0) {
        throw new Error('不能给切削工具单独赋材质，请修改被切削的实体')
      }
      node = node.children[index]!
    }
    clearAppearance(node)
    node.material = { ...change.material }
  }
  next.summary = edit.summary
  return next
}
