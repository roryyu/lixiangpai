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
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { buildCadMesh, disposeCadMesh } from '../../utils/cad-renderer'
import type { CadModel } from '../../../shared/types/cad'

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

let environmentTarget: THREE.WebGLRenderTarget | null = null
let lastGeometryKey = ''

// 材质更新保留用户视角，只有几何结构变化才重新取景。
function geometryKey(model: CadModel): string {
  return JSON.stringify(model.model, (key, value) => key === 'material' || key === 'color' ? undefined : value)
}

function clearModel() {
  modelReady.value = false
  if (!modelGroup || !scene) return
  modelGroup.traverse((obj) => {
    if (obj instanceof THREE.Mesh) disposeCadMesh(obj)
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
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(w, h, false)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.1

  // 本地生成摄影棚环境反射，金属与玻璃不依赖远程 HDR 或纹理资源。
  const room = new RoomEnvironment()
  const pmrem = new THREE.PMREMGenerator(renderer)
  try {
    environmentTarget = pmrem.fromScene(room, 0.04)
    scene.environment = environmentTarget.texture
  } finally {
    room.dispose()
    pmrem.dispose()
  }

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
    gridHelper.dispose()
  }
  const gridSize = Math.max(maxDim * 3, 20)
  gridHelper = new THREE.GridHelper(gridSize, 20, 0x334155, 0x1e293b)
  gridHelper.position.y = -size.y / 2 - maxDim * 0.05
  scene!.add(gridHelper)
}

function renderModel() {
  if (!scene || !camera || !renderer) return
  const previousPosition = modelGroup?.position.clone()
  clearModel()
  if (!props.model) {
    lastGeometryKey = ''
    return
  }

  try {
    const key = geometryKey(props.model)
    const mesh = buildCadMesh(props.model.model)
    modelGroup = new THREE.Group()
    modelGroup.add(mesh)
    scene.add(modelGroup)

    if (key === lastGeometryKey && previousPosition) modelGroup.position.copy(previousPosition)
    else fitCameraToObject(modelGroup)
    onResize()
    renderer.render(scene, camera)
    lastGeometryKey = key
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
  gridHelper?.dispose()
  gridHelper = null
  scene?.traverse(obj => {
    if (obj instanceof THREE.AxesHelper) obj.dispose()
  })
  environmentTarget?.dispose()
  environmentTarget = null
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
