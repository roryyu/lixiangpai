import * as THREE from 'three'
import { ADDITION, SUBTRACTION, INTERSECTION, Brush, Evaluator } from 'three-bvh-csg'
import { isCadBoolean } from '../../shared/types/cad'
import type { CadMaterial, CadNode, CadPrimitive, CadTransform } from '../../shared/types/cad'

const presets: Record<CadMaterial['type'], THREE.MeshPhysicalMaterialParameters> = {
  default: { color: '#22c55e', roughness: 0.55, metalness: 0.15 },
  wood: { color: '#b88752', roughness: 0.48, metalness: 0, clearcoat: 0.18 },
  metal: { color: '#c4c9d0', roughness: 0.24, metalness: 1 },
  glass: { color: '#f0faf8', roughness: 0.06, metalness: 0, transmission: 0.96, ior: 1.5 },
  plastic: { color: '#e5e7eb', roughness: 0.38, metalness: 0, clearcoat: 0.3 },
  ceramic: { color: '#faf5ed', roughness: 0.18, metalness: 0, clearcoat: 0.65 },
  stone: { color: '#b8b3aa', roughness: 0.7, metalness: 0 },
  rubber: { color: '#292b30', roughness: 0.95, metalness: 0 },
}

// 直接在实体坐标中生成纹理；不依赖外部图片或 UV，布尔切面同样有纹理。
const patternShader = `
varying vec3 vCadPosition;
uniform float cadTextureSize;
uniform float cadTextureScale;
uniform int cadPatternType;
uniform int cadGrainAxis;
float cadNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  vec3 stepv = vec3(1.0, 57.0, 113.0);
  float n = dot(i, stepv);
  vec4 a = fract(sin(vec4(n, n+1.0, n+57.0, n+58.0)) * 43758.5453);
  vec4 b = fract(sin(vec4(n+113.0, n+114.0, n+170.0, n+171.0)) * 43758.5453);
  vec4 c = mix(a, b, f.z);
  return mix(mix(c.x, c.y, f.x), mix(c.z, c.w, f.x), f.y);
}
float cadPattern(vec3 p) {
  p = p / cadTextureSize * cadTextureScale;
  if (cadGrainAxis == 0) p = p.yxz;
  if (cadGrainAxis == 2) p = p.xzy;
  if (cadPatternType == 1) {
    float warp = cadNoise(p * vec3(6.0, 0.6, 6.0));
    float ring = length(p.xz + vec2(0.35, 0.18)) * 95.0 + warp * 9.0;
    float grain = 0.5 + 0.5 * sin(ring);
    float pores = cadNoise(p * vec3(180.0, 3.0, 180.0));
    return clamp(grain * 0.7 + pores * 0.3, 0.0, 1.0);
  }
  if (cadPatternType == 2) {
    float phase = p.x * 1900.0 + cadNoise(p * 20.0) * 3.0;
    return 0.5 + 0.5 * sin(phase) / (1.0 + fwidth(phase));
  }
  float vein = sin((p.x + p.z * 0.6) * 26.0 + cadNoise(p * 5.0) * 8.0);
  return mix(0.3, 1.0, smoothstep(-0.9, -0.45, vein));
}
`

export function createCadMaterial(spec: CadMaterial, modelSize = 100): THREE.MeshPhysicalMaterial {
  const parameters = { ...presets[spec.type] }
  if (spec.finish) {
    parameters.roughness = { matte: 0.78, polished: 0.09, brushed: 0.32 }[spec.finish]
  }
  for (const key of ['color', 'roughness', 'metalness', 'transmission', 'opacity', 'ior', 'thickness'] as const) {
    if (spec[key] !== undefined) Object.assign(parameters, { [key]: spec[key] })
  }
  const material = new THREE.MeshPhysicalMaterial({
    ...parameters,
    thickness: spec.thickness ?? (spec.type === 'glass' ? modelSize * 0.08 : 0),
    side: THREE.DoubleSide,
    envMapIntensity: 1.15,
    transparent: (spec.opacity ?? 1) < 1,
    depthWrite: (spec.opacity ?? 1) >= 1,
  })
  material.name = spec.type
  const patternType = spec.type === 'wood' ? 1 : spec.type === 'metal' && spec.finish === 'brushed' ? 2 : spec.type === 'stone' ? 3 : 0
  const uniforms = {
    cadTextureSize: { value: modelSize },
    cadTextureScale: { value: spec.textureScale ?? 1 },
    cadPatternType: { value: patternType },
    cadGrainAxis: { value: { x: 0, y: 1, z: 2 }[spec.grainAxis ?? 'y'] },
  }
  material.userData.cad = { spec, uniforms }
  if (patternType) {
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms)
      shader.vertexShader = `varying vec3 vCadPosition;\n${shader.vertexShader}`.replace(
        '#include <begin_vertex>', '#include <begin_vertex>\nvCadPosition = position;',
      )
      shader.fragmentShader = patternShader + shader.fragmentShader
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
        #include <map_fragment>
        float cadGrain = cadPattern(vCadPosition);
        if (cadPatternType == 1) diffuseColor.rgb *= mix(0.52, 1.12, cadGrain);
        if (cadPatternType == 3) diffuseColor.rgb *= cadGrain;
      `).replace('#include <roughnessmap_fragment>', `
        #include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + (cadGrain - 0.5) * 0.16, 0.04, 1.0);
      `)
    }
    material.customProgramCacheKey = () => 'cad-procedural-v1'
  }
  return material
}

/** 子节点材质从新预设开始，避免把父级金属度或透明度带到木材上。 */
export function resolveCadMaterial(node: CadNode, inherited: CadMaterial = { type: 'default' }): CadMaterial {
  const material = node.material ? { ...node.material } : { ...inherited }
  if (node.color && !node.material?.color) material.color = node.color
  return material
}

function makePrimitiveGeometry(node: CadPrimitive): THREE.BufferGeometry {
  const s = node.size || {}
  switch (node.kind) {
    case 'box': return new THREE.BoxGeometry(s.w ?? 10, s.h ?? 10, s.d ?? 10)
    case 'cylinder': return new THREE.CylinderGeometry(s.radiusTop ?? s.radius ?? 5, s.radiusBottom ?? s.radius ?? 5, s.height ?? 10, 48)
    case 'sphere': return new THREE.SphereGeometry(s.radius ?? 5, 48, 32)
    case 'cone': return new THREE.ConeGeometry(s.radius ?? 5, s.height ?? 10, 48)
    case 'torus': return new THREE.TorusGeometry(s.radius ?? 6, s.tube ?? 2, 24, 64)
    default: throw new Error('不支持的几何类型')
  }
}

function applyTransform(geometry: THREE.BufferGeometry, t?: CadTransform) {
  if (!t) return
  const rotation = new THREE.Euler(...(t.rotate ?? [0, 0, 0]).map(THREE.MathUtils.degToRad) as [number, number, number], 'XYZ')
  geometry.applyMatrix4(new THREE.Matrix4().compose(
    new THREE.Vector3(...(t.translate ?? [0, 0, 0])),
    new THREE.Quaternion().setFromEuler(rotation),
    new THREE.Vector3(...(t.scale ?? [1, 1, 1])),
  ))
}

/** 保留 CSG 的材质分组；切削工具使用基体材质，不能给孔壁染上工具颜色。 */
export function buildCadMesh(root: CadNode): THREE.Mesh {
  const evaluator = new Evaluator()
  evaluator.useGroups = true
  const materials = new Map<string, THREE.MeshPhysicalMaterial>()
  const brushes = new Set<Brush>()
  let result: Brush | undefined
  const getMaterial = (spec: CadMaterial) => {
    const key = JSON.stringify(spec)
    if (!materials.has(key)) materials.set(key, createCadMaterial(spec))
    return materials.get(key)!
  }
  const track = (geometry: THREE.BufferGeometry, material: THREE.Material) => {
    const brush = new Brush(geometry, material)
    brushes.add(brush)
    brush.updateMatrixWorld()
    return brush
  }
  const release = (brush: Brush) => {
    brush.disposeCacheData()
    brush.geometry.dispose()
    brushes.delete(brush)
  }
  const build = (node: CadNode, inherited?: CadMaterial, forced?: THREE.Material): Brush => {
    const spec = resolveCadMaterial(node, inherited)
    const material = forced ?? getMaterial(spec)
    if (!isCadBoolean(node)) {
      const brush = track(makePrimitiveGeometry(node), material)
      applyTransform(brush.geometry, node.transform)
      return brush
    }
    if (!node.children[0]) throw new Error('布尔节点缺少实体')
    let acc = build(node.children[0], spec, forced)
    // 第一个实体的材质用于新切面；多材料基体建议拆开切削后再合并。
    const cutMaterial = Array.isArray(acc.material) ? acc.material[0]! : acc.material
    for (const child of node.children.slice(1)) {
      const b = build(child, spec, node.kind === 'union' ? forced : cutMaterial)
      const target = track(new THREE.BufferGeometry(), material)
      evaluator.evaluate(acc, b, { union: ADDITION, subtract: SUBTRACTION, intersect: INTERSECTION }[node.kind], target)
      target.updateMatrixWorld()
      release(acc)
      release(b)
      acc = target
    }
    return acc
  }
  try {
    result = build(root)
    const geometry = result.geometry
    if (!geometry.getAttribute('position')?.count || geometry.drawRange.count === 0) throw new Error('布尔运算得到空模型，请调整描述')
    geometry.computeBoundingBox()
    const size = geometry.boundingBox!.getSize(new THREE.Vector3())
    const span = Math.max(size.x, size.y, size.z)
    if (!Number.isFinite(span) || span <= 0) throw new Error('模型尺寸无效')
    const used = new Set(Array.isArray(result.material) ? result.material : [result.material])
    for (const material of materials.values()) {
      if (!used.has(material)) continue
      material.userData.cad.uniforms.cadTextureSize.value = span
      const spec: CadMaterial = material.userData.cad.spec
      if (spec.type === 'glass' && spec.thickness === undefined) material.thickness = span * 0.08
    }
    const mesh = new THREE.Mesh(geometry, result.material)
    result.disposeCacheData()
    brushes.delete(result)
    for (const [key, material] of materials) {
      if (used.has(material)) materials.delete(key)
    }
    return mesh
  } finally {
    for (const brush of brushes) release(brush)
    for (const material of materials.values()) material.dispose()
  }
}

export function disposeCadMesh(mesh: THREE.Mesh) {
  mesh.geometry.dispose()
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  new Set(materials).forEach(material => material.dispose())
}
