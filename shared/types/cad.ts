export const CAD_MATERIAL_TYPES = ['default', 'wood', 'metal', 'glass', 'plastic', 'ceramic', 'stone', 'rubber'] as const

export interface CadMaterial {
  type: typeof CAD_MATERIAL_TYPES[number]
  color?: string
  finish?: 'matte' | 'polished' | 'brushed'
  roughness?: number
  metalness?: number
  transmission?: number
  opacity?: number
  ior?: number
  /** 光学厚度，单位与模型一致，不改变几何体。 */
  thickness?: number
  /** 程序纹理的相对密度，默认 1。 */
  textureScale?: number
  grainAxis?: 'x' | 'y' | 'z'
}

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
export type CadBooleanKind = 'union' | 'subtract' | 'intersect'

export interface CadPrimitive {
  kind: CadPrimitiveKind
  size: Record<string, number>
  transform?: CadTransform
  color?: string
  material?: CadMaterial
}
export interface CadBoolean {
  kind: CadBooleanKind
  children: CadNode[]
  color?: string
  material?: CadMaterial
}
export type CadNode = CadPrimitive | CadBoolean
export interface CadModel {
  units: string
  title?: string
  summary?: string
  model: CadNode
}

export function isCadBoolean(node: CadNode): node is CadBoolean {
  return node.kind === 'union' || node.kind === 'subtract' || node.kind === 'intersect'
}
