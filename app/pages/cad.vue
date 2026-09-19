<script setup lang="ts">
import { Upload, CircleClose, Promotion, Picture, Check, Close, Back, Box } from '@element-plus/icons-vue'
import { marked } from 'marked'

definePageMeta({
  middleware: 'auth',
  layout: false,
})

const { data: authData, signOut } = useAuth()
const router = useRouter()

// nuxt-auth 的 SessionData 类型未声明 user 字段，这里宽松取值
const authUser = computed<any>(() => (authData.value as any)?.user)

interface ChatMessage {
  id: string
  type: 'user' | 'ai' | 'error'
  content?: string
  image?: string // data URL 预览
  status?: 'RUNNING' | 'COMPLETED' | 'FAILED'
  title?: string
  summary?: string
  model?: any
  error?: string
  timestamp: Date
}

const messages = ref<ChatMessage[]>([])
const input = ref('')
const uploadedFile = ref<File | null>(null)
const previewUrl = ref<string>('')
const isGenerating = ref(false)
const currentModel = ref<any>(null)
const currentTitle = ref('')
const currentSummary = ref('')
const isExporting = ref(false)
// 仅在当前应用内中转一次；不把图片塞进路由或持久化到浏览器存储。
const workspaceSnapshot = useState<{ dataUrl: string; fileName: string } | null>(
  'cad-workspace-snapshot',
  () => null,
)

async function handleLogout() {
  await signOut()
  router.push('/login')
}

function goWorkspace() {
  router.push('/workspace')
}

async function sendSnapshotToWorkspace(dataUrl: string) {
  if (isExporting.value) return
  isExporting.value = true
  const name = (currentTitle.value || '3D模型').replace(/[\\/:*?"<>|]/g, '-').slice(0, 80)
  const snapshot = { dataUrl, fileName: `${name}-${Date.now()}.png` }
  workspaceSnapshot.value = snapshot
  try {
    const failure = await router.push('/workspace')
    if (failure) throw new Error('未能打开工作台，请重试')
  } catch (error) {
    if (workspaceSnapshot.value?.dataUrl === dataUrl) workspaceSnapshot.value = null
    ElMessage.error(error instanceof Error ? error.message : '截图导入失败，请重试')
  } finally {
    isExporting.value = false
  }
}

// File -> { raw base64, mediaType }
function fileToBase64(file: File): Promise<{ raw: string; mediaType: string; dataUrl: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      const parts = dataUrl.split(',')
      const meta = parts[0] || ''
      const raw = parts[1] || ''
      const mediaType = meta.replace('data:', '').replace(';base64', '') || 'image/jpeg'
      resolve({ raw, mediaType, dataUrl })
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function handleFileUpload(event: Event) {
  const el = event.target as HTMLInputElement
  const file = el.files?.[0]
  if (!file) return
  if (!file.type.startsWith('image/')) {
    ElMessage.error('请上传图片文件')
    el.value = ''
    return
  }
  uploadedFile.value = file
  previewUrl.value = URL.createObjectURL(file)
  el.value = ''
}

function removeFile() {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  uploadedFile.value = null
  previewUrl.value = ''
}

function renderMarkdown(text?: string) {
  if (!text) return ''
  return marked(text, { breaks: true, gfm: true })
}

function onViewerError(msg: string) {
  ElMessage({ type: 'error', message: msg, duration: 10_000, showClose: true })
}

async function sendMessage() {
  const text = input.value.trim()
  if (!text && !uploadedFile.value) {
    ElMessage.warning('请输入描述或上传图片')
    return
  }
  if (isGenerating.value) return

  isGenerating.value = true

  // 用户消息
  let imageDataUrl = ''
  let imageRaw = ''
  let mediaType = 'image/jpeg'
  if (uploadedFile.value) {
    const b = await fileToBase64(uploadedFile.value)
    imageDataUrl = b.dataUrl
    imageRaw = b.raw
    mediaType = b.mediaType
  }

  messages.value.push({
    id: Date.now() + '_u',
    type: 'user',
    content: text || '（仅图片）根据图片生成 3D 模型',
    image: imageDataUrl || previewUrl.value || undefined,
    timestamp: new Date(),
  })

  const aiMsg: ChatMessage = {
    id: Date.now() + '_ai',
    type: 'ai',
    status: 'RUNNING',
    content: '正在生成建模方案…',
    timestamp: new Date(),
  }
  messages.value.push(aiMsg)

  // 清空输入
  const sentText = text
  input.value = ''
  removeFile()

  try {
    const res = await $fetch<{ success: boolean; model: any; title: string; summary: string }>(
      '/api/cad/generate',
      {
        method: 'POST',
        body: {
          text: sentText,
          imageBase64: imageRaw || undefined,
          mediaType: imageRaw ? mediaType : undefined,
        },
      },
    )

    const idx = messages.value.findIndex((m) => m.id === aiMsg.id)
    const done: ChatMessage = {
      ...aiMsg,
      status: 'COMPLETED',
      content: res.summary || '模型生成完成，已在右侧预览。',
      title: res.title,
      summary: res.summary,
      model: res.model,
    }
    if (idx !== -1) messages.value[idx] = done

    currentModel.value = res.model
    currentTitle.value = res.title
    currentSummary.value = res.summary
  } catch (e: any) {
    const msg = e?.data?.message || e?.message || '生成失败，请重试'
    const idx = messages.value.findIndex((m) => m.id === aiMsg.id)
    if (idx !== -1) {
      messages.value[idx] = { ...aiMsg, status: 'FAILED', error: msg, content: '' }
    } else {
      messages.value.push({ id: Date.now() + '_e', type: 'error', content: msg, timestamp: new Date() })
    }
  } finally {
    isGenerating.value = false
  }
}

function clearChat() {
  messages.value = []
  currentModel.value = null
  currentTitle.value = ''
  currentSummary.value = ''
}
</script>

<template>
  <div class="cad-page">
    <el-header class="cad-header">
      <div class="header-left">
        <el-button text :icon="Back" @click="goWorkspace">返回工作台</el-button>
        <span class="divider">|</span>
        <NuxtLink to="/" class="logo">理享派 · 文字建模</NuxtLink>
      </div>
      <div class="header-right">
        <span class="user-name">{{ authUser?.name || authUser?.email }}</span>
        <el-button type="danger" plain size="small" @click="handleLogout">退出登录</el-button>
      </div>
    </el-header>

    <div class="cad-body">
      <!-- 左侧：聊天 -->
      <section class="chat-panel">
        <div class="chat-scroll">
          <div v-if="messages.length === 0" class="welcome">
            <el-icon class="welcome-icon"><Box /></el-icon>
            <h2>文字 / 图片 → 3D 模型</h2>
            <p>描述你想要的零件，例如：</p>
            <ul class="examples">
              <li>一块 60×40×8 的铝板，四角各钻一个 φ6 通孔</li>
              <li>一个底座上加一根竖直圆柱，顶端放一个球</li>
              <li>法兰盘：圆盘中心打孔，周围均布 6 个小孔</li>
            </ul>
            <p class="tip">也可上传一张参考图，AI 会尝试还原其几何形状。</p>
          </div>

          <div v-else class="msg-list">
            <div v-for="m in messages" :key="m.id" :class="['msg', m.type]">
              <!-- 用户 -->
              <div v-if="m.type === 'user'" class="bubble user-bubble">
                <img v-if="m.image" :src="m.image" class="msg-image" />
                <p v-if="m.content">{{ m.content }}</p>
              </div>

              <!-- AI -->
              <div v-else-if="m.type === 'ai'" class="ai-row">
                <div class="ai-avatar">AI</div>
                <div class="bubble ai-bubble">
                  <template v-if="m.status === 'RUNNING'">
                    <el-icon class="is-loading"><Promotion /></el-icon>
                    <span class="loading-text">{{ m.content }}</span>
                  </template>
                  <template v-else-if="m.status === 'COMPLETED'">
                    <div class="done-head">
                      <el-icon color="#67c23a"><Check /></el-icon>
                      <strong>{{ m.title || '模型已生成' }}</strong>
                    </div>
                    <div v-if="m.summary" class="summary" v-html="renderMarkdown(m.summary)"></div>
                    <div class="hint">👉 已在右侧渲染，可拖拽旋转、滚轮缩放</div>
                  </template>
                  <template v-else>
                    <el-icon color="#f56c6c"><Close /></el-icon>
                    <span class="err-text">{{ m.error }}</span>
                  </template>
                </div>
              </div>

              <!-- 错误 -->
              <div v-else class="bubble err-bubble">{{ m.content }}</div>
            </div>
          </div>
        </div>

        <div class="input-area">
          <div v-if="previewUrl" class="preview-row">
            <div class="preview-item">
              <img :src="previewUrl" />
              <el-icon class="remove" @click="removeFile"><CircleClose /></el-icon>
            </div>
          </div>
          <div class="input-box">
            <el-input
              v-model="input"
              type="textarea"
              :rows="2"
              resize="none"
              placeholder="描述你想生成的 3D 模型…（Enter 发送，Shift+Enter 换行）"
              @keydown.enter.exact.prevent="sendMessage"
            />
            <div class="input-actions">
              <label class="upload-btn" title="上传参考图">
                <el-icon><Upload /></el-icon>
                <input type="file" accept="image/*" class="file-input" @change="handleFileUpload" />
              </label>
              <div class="right-actions">
                <el-button v-if="messages.length" text size="small" @click="clearChat">清空</el-button>
                <el-button
                  type="success"
                  class="send-btn"
                  :loading="isGenerating"
                  :disabled="isGenerating || (!input.trim() && !uploadedFile)"
                  @click="sendMessage"
                >
                  <el-icon v-if="!isGenerating"><Promotion /></el-icon>
                </el-button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- 右侧：3D 预览 -->
      <section class="preview-panel">
        <div class="preview-head">
          <span class="preview-title">
            <el-icon><Box /></el-icon>
            {{ currentTitle || '3D 预览' }}
          </span>
          <el-tag v-if="currentModel" type="success" size="small" effect="dark">已渲染</el-tag>
          <el-tag v-else type="info" size="small">等待生成</el-tag>
        </div>
        <div class="preview-canvas">
          <CadViewer3D
            :model="currentModel"
            :exporting="isExporting"
            @snapshot="sendSnapshotToWorkspace"
            @error="onViewerError"
          />
          <div v-if="!currentModel" class="canvas-placeholder">
            <el-icon><Picture /></el-icon>
            <p>生成的模型会显示在这里</p>
          </div>
        </div>
        <div v-if="currentSummary" class="preview-foot">{{ currentSummary }}</div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.cad-page {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f5f7fa;
  overflow: hidden;
}

.cad-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 60px;
  padding: 0 20px;
  background: #fff;
  border-bottom: 1px solid #e4e7ed;
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.divider {
  color: #dcdfe6;
}

.logo {
  font-size: 18px;
  font-weight: 700;
  color: #22c55e;
  text-decoration: none;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.user-name {
  color: #606266;
  font-size: 14px;
}

.cad-body {
  flex: 1;
  display: flex;
  gap: 16px;
  padding: 16px;
  min-height: 0;
}

/* 左侧聊天 */
.chat-panel {
  width: 420px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
  overflow: hidden;
}

.chat-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.welcome {
  color: #606266;
  padding: 20px 8px;
}

.welcome-icon {
  font-size: 56px;
  color: #22c55e;
}

.welcome h2 {
  font-size: 20px;
  color: #16a34a;
  margin: 12px 0;
}

.welcome .examples {
  margin: 8px 0 12px;
  padding-left: 20px;
  color: #475569;
  font-size: 14px;
  line-height: 1.9;
}

.welcome .tip {
  font-size: 13px;
  color: #94a3b8;
}

.msg-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.msg.user {
  display: flex;
  justify-content: flex-end;
}

.bubble {
  max-width: 85%;
  padding: 12px 16px;
  border-radius: 14px;
  font-size: 14px;
  line-height: 1.6;
}

.user-bubble {
  background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
  color: #fff;
  border-radius: 14px 14px 4px 14px;
}

.user-bubble p {
  margin: 0;
}

.msg-image {
  display: block;
  max-width: 160px;
  max-height: 160px;
  border-radius: 8px;
  margin-bottom: 8px;
}

.ai-row {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

.ai-avatar {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
  flex-shrink: 0;
}

.ai-bubble {
  background: #f8fafc;
  border: 1px solid #eef2f7;
  border-radius: 4px 14px 14px 14px;
  flex: 1;
}

.loading-text {
  margin-left: 8px;
  color: #64748b;
}

.done-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

.summary {
  color: #475569;
  font-size: 13px;
}

.summary :deep(p) {
  margin: 4px 0;
}

.hint {
  margin-top: 8px;
  font-size: 12px;
  color: #16a34a;
}

.err-text,
.err-bubble {
  color: #f56c6c;
}

.err-bubble {
  background: #fef0f0;
}

/* 输入区 */
.input-area {
  border-top: 1px solid #f0f0f0;
  padding: 12px;
  flex-shrink: 0;
}

.preview-row {
  margin-bottom: 10px;
}

.preview-item {
  position: relative;
  width: 64px;
  height: 64px;
}

.preview-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 8px;
  border: 1px solid #e4e7ed;
}

.preview-item .remove {
  position: absolute;
  top: -6px;
  right: -6px;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  border-radius: 50%;
  cursor: pointer;
  font-size: 16px;
}

.input-box {
  border: 1px solid #e4e7ed;
  border-radius: 12px;
  padding: 8px 10px;
}

.input-box :deep(.el-textarea__inner) {
  border: none;
  box-shadow: none;
  padding: 0;
  font-size: 14px;
}

.input-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid #f5f5f5;
}

.upload-btn {
  cursor: pointer;
  color: #909399;
  font-size: 20px;
  padding: 4px 8px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  transition: all 0.2s;
}

.upload-btn:hover {
  background: #f0f9ff;
  color: #22c55e;
}

.file-input {
  display: none;
}

.right-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.send-btn {
  width: 38px;
  height: 38px;
  background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
  border: none;
}

.send-btn:disabled {
  background: #d1d5db;
}

/* 右侧预览 */
.preview-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
  overflow: hidden;
  min-width: 0;
}

.preview-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 18px;
  border-bottom: 1px solid #f0f0f0;
}

.preview-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 15px;
  font-weight: 600;
  color: #303133;
  flex: 1;
}

.preview-canvas {
  flex: 1;
  position: relative;
  min-height: 0;
  background: #0f172a;
}

.canvas-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: #64748b;
  pointer-events: none;
  z-index: 5;
}

.canvas-placeholder .el-icon {
  font-size: 48px;
}

.canvas-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #94a3b8;
}

.preview-foot {
  padding: 10px 18px;
  font-size: 12px;
  color: #909399;
  border-top: 1px solid #f0f0f0;
  flex-shrink: 0;
}
</style>
