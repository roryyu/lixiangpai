<script setup lang="ts">
/**
 * CAD 3D 预览组件（对应 text-to-cad 分析文档的 L3/L4：几何求值 + 浏览器显示）。
 *
 * 输入一棵 CadModel DSL（CSG 建模树），用 Three.js 构建基础图元，
 * 用 three-bvh-csg 执行布尔运算（并/差/交），最终渲染为可旋转缩放的 3D 模型。
 *
 * 仅在客户端运行（.client.vue），因为依赖 WebGL / DOM。
 */
import * as THREE from 'three'
import { Camera, Download } from '@element-plus/icons-vue'
import { geometryToTriangles, trianglesToDxf } from '../../../shared/utils/cad-export'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { ADDITION, SUBTRACTION, INTERSECTION, Brush, Evaluator } from 'three-bvh-csg'
import type { CSGOperation } from 'three-bvh-csg'

interface CadTransform {
  translate?: [number, number, number]
  rotate?: [number, number, number]
  scale?: [number, number, number]
}
interface CadPrimitive {
  kind: 'box' | 'cylinder' | 'sphere' | 'cone' | 'torus'
  size: Record<string, number>
  transform?: CadTransform
  color?: string
}
interface CadBoolean {
  kind: 'union' | 'subtract' | 'intersect'
  children: CadNode[]
  color?: string
}
type CadNode = CadPrimitive | CadBoolean
interface CadModel {
  units?: string
  title?: string
  summary?: string
  model: CadNode
}

const props = defineProps<{ model: CadModel | null; exporting?: boolean }>()
const emit = defineEmits<{
  (e: 'error', msg: string): void
  (e: 'snapshot', dataUrl: string): void
}>()
const modelReady = ref(false)
const isSavingDxf = ref(false)

const container = ref<HTMLDivElement | null>(null)
const canvasEl = ref<HTMLCanvasElement | null>(null)
let initialized = false

let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let controls: OrbitControls | null = null
let modelGroup: THREE.Group | null = null
let gridHelper: THREE.GridHelper | null = null
let rafId = 0
let resizeObserver: ResizeObserver | null = null

const evaluator = new Evaluator()
const DEFAULT_COLOR = '#22c55e'

function isBoolean(node: CadNode): node is CadBoolean {
  return node.kind === 'union' || node.kind === 'subtract' || node.kind === 'intersect'
}

/** 根据图元类型创建 Three.js 几何体（尺寸取自 DSL 的 size 参数） */
function makePrimitiveGeometry(node: CadPrimitive): THREE.BufferGeometry {
  const s = node.size || {}
  switch (node.kind) {
    case 'box':
      return new THREE.BoxGeometry(s.w ?? 10, s.h ?? 10, s.d ?? 10)
    case 'cylinder': {
      const rt = s.radiusTop ?? s.radius ?? 5
      const rb = s.radiusBottom ?? s.radius ?? 5
      return new THREE.CylinderGeometry(rt, rb, s.height ?? 10, 48)
    }
    case 'sphere':
      return new THREE.SphereGeometry(s.radius ?? 5, 48, 32)
    case 'cone':
      return new THREE.ConeGeometry(s.radius ?? 5, s.height ?? 10, 48)
    case 'torus':
      return new THREE.TorusGeometry(s.radius ?? 6, s.tube ?? 2, 24, 64)
    default:
      return new THREE.BoxGeometry(10, 10, 10)
  }
}

/** 把 transform（平移/旋转/缩放）烘焙进几何体，使 CSG 在统一空间求值 */
function applyTransform(geo: THREE.BufferGeometry, t?: CadTransform) {
  if (!t) return
  const pos = new THREE.Vector3(...(t.translate ?? [0, 0, 0]))
  const rot = new THREE.Euler(
    THREE.MathUtils.degToRad(t.rotate?.[0] ?? 0),
    THREE.MathUtils.degToRad(t.rotate?.[1] ?? 0),
    THREE.MathUtils.degToRad(t.rotate?.[2] ?? 0),
    'XYZ',
  )
  const scale = new THREE.Vector3(...(t.scale ?? [1, 1, 1]))
  const m = new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromEuler(rot), scale)
  geo.applyMatrix4(m)
}

/** 递归把 DSL 节点树求值为一个 Brush（CSG 结果） */
function buildBrush(node: CadNode, material: THREE.Material): Brush {
  if (!isBoolean(node)) {
    const geo = makePrimitiveGeometry(node)
    applyTransform(geo, node.transform)
    const brush = new Brush(geo, material)
    brush.updateMatrixWorld()
    return brush
  }

  const children = node.children
  const first = children?.[0]
  if (!first) {
    // 异常兜底：空布尔节点返回一个单位立方体
    const g = new THREE.BoxGeometry(1, 1, 1)
    const fb = new Brush(g, material)
    fb.updateMatrixWorld()
    return fb
  }
  if (children!.length < 2) {
    return buildBrush(first, material)
  }

  const opMap: Record<string, CSGOperation> = {
    union: ADDITION,
    subtract: SUBTRACTION,
    intersect: INTERSECTION,
  }
  const op = opMap[node.kind] ?? ADDITION
  let acc = buildBrush(first, material)
  for (let i = 1; i < children!.length; i++) {
    const child = children![i]
    if (!child) continue
    const b = buildBrush(child, material)
    acc = evaluator.evaluate(acc, b, op)
    acc.updateMatrixWorld()
  }
  return acc
}

/** 找到 DSL 树里第一个声明的颜色，作为整体材质色 */
function pickColor(node: CadNode): string {
  if (node.color) return node.color
  if (isBoolean(node)) {
    for (const c of node.children) {
      const col = pickColor(c)
      if (col) return col
    }
  }
  return DEFAULT_COLOR
}

function clearModel() {
  modelReady.value = false
  if (!modelGroup || !scene) return
  modelGroup.traverse((obj: any) => {
    if (obj.geometry) obj.geometry.dispose()
    if (obj.material) obj.material.dispose()
  })
  scene.remove(modelGroup)
  modelGroup = null
}

function initScene() {
  if (!container.value || !canvasEl.value) return
  if (initialized) return
  initialized = true

  scene = new THREE.Scene()
  scene.background = new THREE.Color('#0f172a')

  const { w, h } = getSize()

  camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100000)
  camera.position.set(60, 50, 80)

  // 直接绑定模板自带的 canvas，避免 appendChild 时机问题
  renderer = new THREE.WebGLRenderer({ canvas: canvasEl.value, antialias: true })
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.setSize(w, h, false)

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08

  // 灯光
  scene.add(new THREE.AmbientLight(0xffffff, 0.6))
  const dir1 = new THREE.DirectionalLight(0xffffff, 1.0)
  dir1.position.set(1, 2, 1.5)
  scene.add(dir1)
  const dir2 = new THREE.DirectionalLight(0xffffff, 0.4)
  dir2.position.set(-1.5, -1, -1)
  scene.add(dir2)

  // 坐标轴
  scene.add(new THREE.AxesHelper(20))

  const animate = () => {
    rafId = requestAnimationFrame(animate)
    controls?.update()
    renderer?.render(scene!, camera!)
  }
  animate()

  resizeObserver = new ResizeObserver(() => onResize())
  resizeObserver.observe(container.value)
  // 首帧后再同步一次，兼容 ClientOnly 挂载时布局尚未完成的情况
  onResize()
}

/** 读取容器实际像素尺寸，兼容挂载初期为 0 的情况 */
function getSize(): { w: number; h: number } {
  const el = container.value
  if (!el) return { w: 600, h: 400 }
  const w = el.clientWidth || el.parentElement?.clientWidth || 600
  const h = el.clientHeight || el.parentElement?.clientHeight || 400
  return { w, h }
}

function onResize() {
  if (!container.value || !renderer || !camera) return
  const { w, h } = getSize()
  if (w === 0 || h === 0) return
  camera.aspect = w / h
  camera.updateProjectionMatrix()
  renderer.setSize(w, h, false)
}

/** 依据模型包围盒自动居中并调整相机 */
function fitCameraToObject(object: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(object)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z) || 10

  object.position.sub(center) // 居中到原点

  const dist = maxDim * 2.2
  camera!.position.set(dist * 0.8, dist * 0.7, dist)
  camera!.near = maxDim / 100
  camera!.far = maxDim * 100
  camera!.updateProjectionMatrix()
  controls!.target.set(0, 0, 0)
  controls!.update()

  // 网格地面
  if (gridHelper && scene) {
    scene.remove(gridHelper)
    gridHelper.geometry.dispose()
  }
  const gridSize = Math.max(maxDim * 3, 20)
  gridHelper = new THREE.GridHelper(gridSize, 20, 0x334155, 0x1e293b)
  gridHelper.position.y = -size.y / 2 - maxDim * 0.05
  scene!.add(gridHelper)
}

function renderModel() {
  if (!scene || !camera || !renderer) return
  clearModel()
  if (!props.model) return

  try {
    const color = pickColor(props.model.model)
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      metalness: 0.15,
      roughness: 0.55,
      side: THREE.DoubleSide,
    })

    const brush = buildBrush(props.model.model, material)
    const mesh = new THREE.Mesh(brush.geometry, material)

    modelGroup = new THREE.Group()
    modelGroup.add(mesh)
    scene.add(modelGroup)

    fitCameraToObject(modelGroup)
    onResize()
    renderer.render(scene, camera)
    modelReady.value = true
  } catch (e: any) {
    clearModel()
    console.error('[Viewer3D] 建模失败:', e)
    emit('error', e?.message || '模型构建失败，请调整描述后重试')
  }
}

/** 同步重绘后立即导出，避免默认 WebGL 绘图缓冲已清空导致黑图。 */
function captureSnapshot() {
  if (props.exporting || isSavingDxf.value || !modelReady.value) return
  try {
    if (!renderer || !scene || !camera || renderer.getContext().isContextLost()) {
      throw new Error('3D 引擎尚未就绪，请稍后重试')
    }
    if (!container.value?.clientWidth || !container.value.clientHeight) {
      throw new Error('画布不可见，请展开预览后重试')
    }
    // 保留当前相机视角；只导出画布，不包含悬浮按钮和聊天内容。
    onResize()
    renderer.render(scene, camera)
    const dataUrl = renderer.domElement.toDataURL('image/png')
    if (!dataUrl.startsWith('data:image/png;base64,')) {
      throw new Error('截图生成失败，请重试')
    }
    emit('snapshot', dataUrl)
  } catch (error) {
    emit('error', error instanceof Error ? error.message : '截图失败，请重试')
  }
}

/** 浏览器直接编码并下载三维 DXF（以 3DFACE 保存网格），无需任何服务端或外部转换器。 */
async function saveDxf() {
  if (props.exporting || isSavingDxf.value || !modelReady.value) return
  const mesh = modelGroup?.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh)
  if (!mesh) return
  const fileName = (props.model?.title || '3D模型').replace(/[\\/:*?"<>|\x00-\x1f]/g, '-').slice(0, 80) + '.dxf'
  const units = props.model?.units || 'mm'
  isSavingDxf.value = true
  try {
    await nextTick()
    // 几何体已烘焙建模变换；不导出预览居中位移、网格地面或坐标轴。
    const dxf = trianglesToDxf(geometryToTriangles(mesh.geometry), units)
    const url = URL.createObjectURL(new Blob([dxf], { type: 'image/vnd.dxf' }))
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    document.body.appendChild(link)
    try {
      link.click()
    } finally {
      link.remove()
      // 下载开始后再释放对象 URL，避免部分浏览器取消尚未读取的文件。
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
    }
  } catch (error) {
    emit('error', error instanceof Error ? error.message : 'DXF 保存失败，请重试')
  } finally {
    isSavingDxf.value = false
  }
}

onMounted(() => {
  initScene()
  renderModel()
})

// 兜底：若 onMounted 时 canvas ref 尚未就绪，等其可用后再初始化
watch(canvasEl, (el) => {
  if (el && !initialized) {
    initScene()
    renderModel()
  }
})

watch(() => props.model, () => renderModel(), { deep: true })

onBeforeUnmount(() => {
  cancelAnimationFrame(rafId)
  resizeObserver?.disconnect()
  controls?.dispose()
  clearModel()
  if (gridHelper) {
    gridHelper.geometry.dispose()
    ;(gridHelper.material as THREE.Material).dispose()
  }
  renderer?.dispose()
  renderer = null
  scene = null
  camera = null
  initialized = false
})
</script>

<template>
  <div ref="container" class="viewer3d">
    <canvas ref="canvasEl" class="viewer-canvas"></canvas>
    <div class="viewer-actions">
      <el-button
        type="primary"
        :icon="Download"
        :loading="isSavingDxf"
        :disabled="!modelReady || exporting || isSavingDxf"
        title="直接下载三维 DXF 网格文件，可用 AutoCAD 打开，无需服务器或转换工具"
        @click.stop="saveDxf"
      >
        {{ isSavingDxf ? '正在导出…' : '保存 DXF' }}
      </el-button>
      <el-button
        class="snapshot-button"
        type="success"
        :icon="Camera"
        :loading="exporting"
        :disabled="!modelReady || exporting || isSavingDxf"
        title="按当前视角截图，在工作台新建对话并添加为上传图片"
        @click.stop="captureSnapshot"
      >
        截图到工作台
      </el-button>
    </div>
  </div>
</template>

<style scoped>
.viewer3d {
  position: absolute;
  inset: 0;
  overflow: hidden;
  border-radius: 12px;
}
.viewer-actions {
  position: absolute;
  top: 16px;
  right: 16px;
  max-width: calc(100% - 32px);
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  z-index: 10;
}
.viewer-actions .el-button + .el-button {
  margin-left: 0;
}
.viewer-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}
</style>
