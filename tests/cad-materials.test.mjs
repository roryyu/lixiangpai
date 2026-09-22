import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerHooks } from 'node:module'
import { ShaderLib, UniformsUtils, Material, BufferGeometry, Vector3 } from 'three'
import { geometryToTriangles } from '../shared/utils/cad-export.ts'

// Nuxt 使用无扩展名的 TS 导入；测试沿用 Node 内置类型剥离，不增加运行依赖。
registerHooks({
  resolve(specifier, context, nextResolve) {
    try { return nextResolve(specifier, context) }
    catch (error) {
      if (error.code === 'ERR_MODULE_NOT_FOUND' && specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) {
        return nextResolve(`${specifier}.ts`, context)
      }
      throw error
    }
  },
})
const { cadModelSchema, cadMaterialSchema, cadMaterialEditSchema, applyCadMaterialEdit } = await import('../server/utils/cad/schema.ts')
const { buildCadMesh, disposeCadMesh, createCadMaterial, resolveCadMaterial } = await import('../app/utils/cad-renderer.ts')
const { buildCadSystemPrompt, buildCadMaterialSystemPrompt, buildCadMaterialPrompt } = await import('../server/utils/cad/prompts.ts')
const { CAD_MATERIAL_TYPES } = await import('../shared/types/cad.ts')
const box = (material, x = 0) => ({ kind: 'box', size: { w: 20, h: 10, d: 12 }, transform: { translate: [x, 0, 0] }, ...(material ? { material } : {}) })
const assembly = () => ({ units: 'mm', title: '测试组合', model: { kind: 'union', children: [box({ type: 'wood' }, -15), box({ type: 'metal' }, 15)] } })
const materialsOf = mesh => Array.isArray(mesh.material) ? mesh.material : [mesh.material]
const geometryOnly = model => JSON.parse(JSON.stringify(model.model, (key, value) => ['material', 'color'].includes(key) ? undefined : value))

test('兼容旧模型并保留嵌套材质字段', () => {
  assert.equal(cadModelSchema.parse({ model: box() }).units, 'mm')
  assert.deepEqual(cadModelSchema.parse(assembly()), assembly())
  const colored = { ...box(), color: '#ff0000' }
  const mesh = buildCadMesh(colored)
  assert.equal(mesh.material.color.getHexString(), 'ff0000')
  disposeCadMesh(mesh)
})

test('材质参数只接受受约束的有限数值、类型与颜色', () => {
  for (const type of CAD_MATERIAL_TYPES) assert.equal(cadMaterialSchema.parse({ type }).type, type)
  for (const invalid of [
    { type: 'unknown' }, { type: 'wood', color: 'url(x)' }, { type: 'wood', textureScale: 0 },
    { type: 'glass', ior: 3 }, { type: 'glass', transmission: 1.1 }, { type: 'wood', roughness: -1 },
    { type: 'metal', roughness: NaN }, { type: 'metal', metalness: Infinity },
    { type: 'glass', thickness: -1 }, { type: 'wood', map: 'https://example.com/a.png' },
  ]) assert.equal(cadMaterialSchema.safeParse(invalid).success, false)
})

test('超深或超大模型在递归解析前拒绝', () => {
  let node = box()
  for (let i = 0; i < 30; i++) node = { kind: 'union', children: [node, box()] }
  assert.equal(cadModelSchema.safeParse({ model: node }).success, false)
  assert.equal(cadModelSchema.safeParse({ model: { kind: 'union', children: Array.from({ length: 200 }, () => box()) } }).success, false)
})

test('金属、玻璃、木质预设有不同物理表现，可调表面处理', () => {
  const metal = createCadMaterial({ type: 'metal', finish: 'polished' })
  const glass = createCadMaterial({ type: 'glass' }, 50)
  const wood = createCadMaterial({ type: 'wood', finish: 'matte' })
  assert.equal(metal.metalness, 1)
  assert.equal(metal.roughness, 0.09)
  assert.equal(glass.transmission, 0.96)
  assert.equal(glass.opacity, 1)
  assert.equal(glass.thickness, 4)
  assert.equal(glass.ior, 1.5)
  assert.equal(wood.metalness, 0)
  assert.equal(wood.roughness, 0.78)
  const custom = createCadMaterial({ type: 'glass', roughness: 0.5, thickness: 2, opacity: 0.8 })
  assert.equal(custom.roughness, 0.5)
  assert.equal(custom.thickness, 2)
  assert.equal(custom.transparent, true)
  ;[metal, glass, wood, custom].forEach(material => material.dispose())
})

test('程序纹理注入木纹、拉丝与石纹，且不依赖外部贴图', () => {
  for (const spec of [{ type: 'wood' }, { type: 'metal', finish: 'brushed' }, { type: 'stone' }]) {
    const material = createCadMaterial(spec)
    const shader = { ...ShaderLib.physical, uniforms: UniformsUtils.clone(ShaderLib.physical.uniforms) }
    material.onBeforeCompile(shader, null)
    assert.match(shader.vertexShader, /vCadPosition = position/)
    assert.match(shader.fragmentShader, /float cadGrain = cadPattern/)
    assert.ok(shader.uniforms.cadPatternType.value > 0)
    assert.equal(material.map, null)
    assert.equal(material.roughnessMap, null)
    material.dispose()
  }
})

test('显式子材质不继承父级金属度和透光度，旧颜色仍可覆盖继承色', () => {
  assert.deepEqual(resolveCadMaterial(box({ type: 'wood' }), { type: 'glass', transmission: 1 }), { type: 'wood' })
  assert.deepEqual(resolveCadMaterial({ ...box(), color: '#ff0000' }, { type: 'wood', color: '#ffffff' }), { type: 'wood', color: '#ff0000' })
  assert.equal(resolveCadMaterial({ ...box({ type: 'metal', color: '#cccccc' }), color: '#ff0000' }).color, '#cccccc')
})

test('真实 CSG 并集保留木、金属、玻璃分组与材质索引', () => {
  const root = assembly().model
  root.children.push(box({ type: 'glass' }, 45))
  const mesh = buildCadMesh(root)
  const materials = materialsOf(mesh)
  assert.deepEqual(new Set(materials.map(material => material.name)), new Set(['wood', 'metal', 'glass']))
  assert.ok(mesh.geometry.groups.length >= 3)
  for (const group of mesh.geometry.groups) assert.ok(materials[group.materialIndex])
  assert.ok(geometryToTriangles(mesh.geometry).length >= 36 * 9)
  disposeCadMesh(mesh)
})

test('差集及交集切面沿用基体，不混入工具材质', () => {
  for (const kind of ['subtract', 'intersect']) {
    const mesh = buildCadMesh({ kind, children: [box({ type: 'wood' }), { kind: 'cylinder', size: { radius: 3, height: 20 }, material: { type: 'glass' } }] })
    assert.deepEqual(new Set(materialsOf(mesh).map(material => material.name)), new Set(['wood']))
    assert.ok(geometryToTriangles(mesh.geometry).length > 0)
    disposeCadMesh(mesh)
  }
})

test('父节点材质继承、嵌套局部覆盖和旋转缩放保留', () => {
  const root = { kind: 'union', material: { type: 'wood' }, children: [box(undefined, -20), { ...box({ type: 'metal' }, 20), transform: { translate: [20, 0, 0], rotate: [0, 90, 0], scale: [2, 1, 1] } }] }
  const mesh = buildCadMesh(root)
  assert.deepEqual(new Set(materialsOf(mesh).map(material => material.name)), new Set(['wood', 'metal']))
  assert.ok(mesh.geometry.boundingBox.getSize(new Vector3()).z >= 40)
  disposeCadMesh(mesh)
})

test('整体改材质清除旧颜色与局部材质，输入模型不被修改', () => {
  const model = assembly()
  const before = structuredClone(model)
  model.model.children[0].color = '#ff0000'
  const updated = applyCadMaterialEdit(model, cadMaterialEditSchema.parse({ summary: '整体玻璃', changes: [{ path: [], material: { type: 'glass' } }] }))
  assert.deepEqual(geometryOnly(updated), geometryOnly(model))
  assert.equal(updated.title, model.title)
  assert.equal(updated.units, model.units)
  assert.equal(updated.model.material.type, 'glass')
  assert.equal(updated.model.children[0].color, undefined)
  assert.equal(updated.model.children[1].material, undefined)
  assert.equal(model.model.children[0].material.type, before.model.children[0].material.type)
})

test('局部修改不影响兄弟部件；更深的例外覆盖整体修改', () => {
  const model = assembly()
  const updated = applyCadMaterialEdit(model, { summary: '局部修改', changes: [{ path: [0], material: { type: 'glass' } }] })
  assert.deepEqual(updated.model.children[1], model.model.children[1])
  const mixed = applyCadMaterialEdit(model, { summary: '整体木材、局部金属', changes: [{ path: [1], material: { type: 'metal' } }, { path: [], material: { type: 'wood' } }] })
  assert.equal(mixed.model.material.type, 'wood')
  assert.equal(mixed.model.children[1].material.type, 'metal')
  assert.deepEqual(geometryOnly(mixed), geometryOnly(model))
})

test('非法编辑路径、工具体和几何修改请求均拒绝', () => {
  const model = assembly()
  assert.throws(() => applyCadMaterialEdit(model, { summary: '', changes: [{ path: [9], material: { type: 'wood' } }] }), /不存在/)
  model.model.kind = 'subtract'
  assert.throws(() => applyCadMaterialEdit(model, { summary: '', changes: [{ path: [1], material: { type: 'wood' } }] }), /切削工具/)
  for (const change of [
    { path: [-1], material: { type: 'wood' } }, { path: [0.5], material: { type: 'wood' } },
    { path: [], material: { type: 'wood' }, size: { w: 300 } },
  ]) assert.equal(cadMaterialEditSchema.safeParse({ summary: '', changes: [change] }).success, false)
  assert.equal(cadMaterialEditSchema.safeParse({ summary: '', changes: [], model: box() }).success, false)
})

test('更换材质后的导出几何不变（忽略分组重排）', () => {
  const model = assembly()
  const edited = applyCadMaterialEdit(model, { summary: '玻璃', changes: [{ path: [], material: { type: 'glass' } }] })
  const oldMesh = buildCadMesh(model.model)
  const newMesh = buildCadMesh(edited.model)
  const canonical = mesh => {
    const values = geometryToTriangles(mesh.geometry)
    return Array.from({ length: values.length / 9 }, (_, i) => values.slice(i * 9, i * 9 + 9).join(',')).sort()
  }
  assert.deepEqual(canonical(newMesh), canonical(oldMesh))
  disposeCadMesh(oldMesh)
  disposeCadMesh(newMesh)
})

test('反复构建、释放和中途失败不遗留材质或几何资源', () => {
  const materialDispose = Material.prototype.dispose
  const geometryDispose = BufferGeometry.prototype.dispose
  let materialCount = 0, geometryCount = 0
  Material.prototype.dispose = function () { materialCount++; materialDispose.call(this) }
  BufferGeometry.prototype.dispose = function () { geometryCount++; geometryDispose.call(this) }
  try {
    for (let i = 0; i < 3; i++) disposeCadMesh(buildCadMesh(assembly().model))
    assert.ok(materialCount >= 9)
    assert.ok(geometryCount >= 9)
    const before = geometryCount
    assert.throws(() => buildCadMesh({ kind: 'union', children: [box(), { kind: 'invalid', size: {} }] }))
    assert.ok(geometryCount > before)
  } finally {
    Material.prototype.dispose = materialDispose
    BufferGeometry.prototype.dispose = geometryDispose
  }
})

test('生成及仅改材质提示词包含完整材质契约与当前模型', () => {
  assert.match(buildCadSystemPrompt(), /wood.*metal.*glass/)
  assert.match(buildCadSystemPrompt(), /material.color/)
  assert.match(buildCadMaterialSystemPrompt(), /不得改变几何/)
  assert.match(buildCadMaterialPrompt('改为木质', assembly()), /测试组合/)
})
