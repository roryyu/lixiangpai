<script setup lang="ts">
import { Upload, CircleClose, Promotion, Search, Picture, Check, Close } from '@element-plus/icons-vue'

definePageMeta({
  middleware: 'auth',
  layout: false,
})

const { data: authData, signOut } = useAuth()
const router = useRouter()

const histories = ref<any[]>([])
const message = ref('')
const uploadedFiles = ref<File[]>([])
const previewUrls = ref<string[]>([])
const currentTask = ref<any>(null)
const isPolling = ref(false)
const chatMessages = ref<any[]>([])
const isSending = ref(false)

// File 转 Base64
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

async function handleLogout() {
  await signOut()
  router.push('/login')
}

async function loadHistories() {
  try {
    const res = await $fetch('/api/tasks') as any
    histories.value = res.tasks || []
  } catch (error) {
    console.error('加载历史记录失败', error)
  }
}

function formatDate(date: string | Date) {
  const d = new Date(date)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function handleFileUpload(event: Event) {
  const input = event.target as HTMLInputElement
  const files = input.files
  if (!files) return
  const maxFiles=9;
  const remainingSlots = maxFiles - uploadedFiles.value.length
  const filesToAdd = Array.from(files).slice(0, remainingSlots)

  filesToAdd.forEach((file) => {
    uploadedFiles.value.push(file)
    const url = URL.createObjectURL(file)
    previewUrls.value.push(url)
  })
}

function removeFile(index: number) {
  URL.revokeObjectURL(previewUrls.value[index])
  uploadedFiles.value.splice(index, 1)
  previewUrls.value.splice(index, 1)
}

// 轮询任务状态
async function pollTaskStatus(taskId: string) {
  isPolling.value = true
  let pollCount = 0
  const maxPolls = 60 // 最多轮询60次

  while (isPolling.value && pollCount < maxPolls) {
    try {
      const res = await $fetch(`/api/tasks/${taskId}`) as any
      currentTask.value = res.task

      // 更新消息状态
      const taskMsg = chatMessages.value.find((m: any) => m.taskId === taskId)
      if (taskMsg) {
        taskMsg.status = res.task.status
        taskMsg.progress = res.task.progress
        taskMsg.message = res.task.message

        if (res.task.status === 'COMPLETED') {
          taskMsg.response = res.task.outputData
          taskMsg.resultData = res.task.outputData
          isPolling.value = false
          break
        }

        if (res.task.status === 'FAILED') {
          taskMsg.error = res.task.errorMsg
          isPolling.value = false
          break
        }
      }

      // 任务完成或失败时停止轮询
      if (res.task.status === 'COMPLETED' || res.task.status === 'FAILED') {
        isPolling.value = false
        break
      }
    } catch (error) {
      console.error('轮询任务状态失败:', error)
    }

    pollCount++
    await new Promise(resolve => setTimeout(resolve, 2000)) // 每2秒轮询一次
  }

  isPolling.value = false
}

// 发送消息/开始识别任务
async function sendMessage() {
  if (uploadedFiles.value.length === 0) {
    return
  }

  isSending.value = true

  try {
    // 将文件转换为 Base64 用于持久化显示
    const filesWithBase64 = await Promise.all(
      uploadedFiles.value.map(async (f) => ({
        name: f.name,
        size: f.size,
        base64: await fileToBase64(f),
      }))
    )

    // 添加用户消息（上传图片）
    const userMessage = {
      id: Date.now().toString(),
      type: 'user',
      content: message.value || '上传图片进行识别',
      files: filesWithBase64,
      timestamp: new Date(),
    }
    chatMessages.value.push(userMessage)

    const formData = new FormData()
    formData.append('image', uploadedFiles.value[0])
    formData.append('name', message.value || '图片识别任务')

    // 清空输入
    message.value = ''
    uploadedFiles.value = []
    previewUrls.value.forEach(url => URL.revokeObjectURL(url))
    previewUrls.value = []

    // 添加 AI 响应占位消息
    const aiMessage = {
      id: Date.now().toString() + '_ai',
      type: 'ai',
      taskId: '',
      status: 'PENDING',
      progress: 0,
      message: '任务创建中...',
      response: null,
      resultData: null,
      error: null,
      timestamp: new Date(),
    }
    chatMessages.value.push(aiMessage)

    // 调用开始任务接口
    const startRes = await $fetch('/api/tasks/start', {
      method: 'POST',
      body: formData,
    }) as any

    currentTask.value = startRes.task
    aiMessage.taskId = startRes.task.id
    aiMessage.status = startRes.task.status
    aiMessage.message = startRes.task.message

    // 开始轮询任务状态
    await pollTaskStatus(startRes.task.id)

    // 刷新历史记录
    await loadHistories()

  } catch (error: any) {
    console.error('发送消息失败:', error)
    chatMessages.value.push({
      id: Date.now().toString() + '_error',
      type: 'error',
      content: error.message || '消息发送失败，请重试',
      timestamp: new Date(),
    })
  } finally {
    isSending.value = false
  }
}

// 格式化文件大小
function formatFileSize(bytes: number) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}

onMounted(() => {
  loadHistories()
})
</script>

<template>
  <div class="workspace-container">
    <el-container class="workspace-layout">
      <el-header class="workspace-header">
        <div class="header-left">
          <NuxtLink to="/" class="logo">
            理享派
          </NuxtLink>
        </div>
        <div class="header-right">
          <span class="user-name">{{ authData?.user?.name || authData?.user?.email }}</span>
          <el-button type="danger" plain size="small" @click="handleLogout">
            退出登录
          </el-button>
        </div>
      </el-header>

      <el-container class="workspace-content">
        <el-aside width="280px" class="history-aside">
          <div class="history-header">
            <span>历史记录</span>
          </div>
          <div class="history-list">
            <div
              v-for="item in histories"
              :key="item.id"
              class="history-item"
            >
              <div class="history-name">{{ item.name || '未命名对话' }}</div>
              <div class="history-status">
                <el-tag :type="item.status === 'COMPLETED' ? 'success' : item.status === 'FAILED' ? 'danger' : 'warning'" size="small">
                  {{ item.status === 'COMPLETED' ? '已完成' : item.status === 'FAILED' ? '失败' : item.status === 'RUNNING' ? '处理中' : '等待中' }}
                </el-tag>
              </div>
              <div class="history-time">{{ formatDate(item.createdAt) }}</div>
            </div>
            <div v-if="histories.length === 0" class="empty-history">
              暂无历史记录
            </div>
          </div>
        </el-aside>

        <el-main class="chat-main">
          <div class="chat-container">
            <div class="chat-area">
              <div v-if="chatMessages.length === 0" class="welcome-message">
                <el-icon class="welcome-icon"><Picture /></el-icon>
                <h2>欢迎使用理享派</h2>
                <p>上传 CAD 设计稿图片，AI 将自动识别并提取结构化信息</p>
                <p class="tip">支持 PNG/JPG/BMP/TIFF 格式，最大 50MB</p>
              </div>
              <div v-else class="messages-list">
                <div
                  v-for="msg in chatMessages"
                  :key="msg.id"
                  :class="['message-item', msg.type]"
                >
                  <!-- 用户消息 -->
                  <div v-if="msg.type === 'user'" class="user-message">
                    <div class="message-content">
                      <p>{{ msg.content }}</p>
                      <div v-if="msg.files && msg.files.length > 0" class="file-info">
                        <div v-for="(file, idx) in msg.files" :key="idx" class="file-item">
                          <el-image
                            v-if="file.base64"
                            :src="file.base64"
                            class="preview-image-small"
                            fit="cover"
                            :preview-src-list="[file.base64]"
                            :preview-teleported="true"
                          >
                            <template #error>
                              <div class="image-error">
                                <el-icon><Picture /></el-icon>
                                <span>加载失败</span>
                              </div>
                            </template>
                          </el-image>
                          <span>{{ file.name }} ({{ formatFileSize(file.size) }})</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- AI 消息 -->
                  <div v-else-if="msg.type === 'ai'" class="ai-message">
                    <div class="ai-avatar">AI</div>
                    <div class="message-content">
                      <!-- 加载中状态 -->
                      <div v-if="msg.status === 'PENDING' || msg.status === 'RUNNING'" class="loading-state">
                        <el-icon class="is-loading loading-icon"><Promotion /></el-icon>
                        <span class="status-text">{{ msg.message }}</span>
                        <el-progress
                          :percentage="msg.progress || 0"
                          :show-text="false"
                          :stroke-width="6"
                          class="progress-bar"
                        />
                      </div>

                      <!-- 成功结果 -->
                      <div v-else-if="msg.status === 'COMPLETED' && msg.resultData" class="result-content">
                        <div class="result-header">
                          <el-icon color="#67c23a"><Check /></el-icon>
                          <span>识别完成</span>
                        </div>

                        <!-- 图纸信息 -->
                        <div v-if="msg.resultData.drawing_info" class="result-section">
                          <h4>📋 图纸信息</h4>
                          <div class="info-grid">
                            <div class="info-item" v-if="msg.resultData.drawing_info.title">
                              <span class="label">标题</span>
                              <span class="value">{{ msg.resultData.drawing_info.title }}</span>
                            </div>
                            <div class="info-item" v-if="msg.resultData.drawing_info.type">
                              <span class="label">类型</span>
                              <span class="value">{{ msg.resultData.drawing_info.type }}</span>
                            </div>
                            <div class="info-item" v-if="msg.resultData.drawing_info.unit">
                              <span class="label">单位</span>
                              <span class="value">{{ msg.resultData.drawing_info.unit }}</span>
                            </div>
                          </div>
                        </div>

                        <!-- 元素列表 -->
                        <div v-if="msg.resultData.elements && msg.resultData.elements.length > 0" class="result-section">
                          <h4>🏗 识别元素 ({{ msg.resultData.elements.length }})</h4>
                          <div class="elements-list">
                            <div v-for="(el, idx) in msg.resultData.elements.slice(0, 10)" :key="idx" class="element-item">
                              <el-tag :type="el.confidence === 'high' ? 'success' : el.confidence === 'medium' ? 'warning' : 'info'" size="small">
                                {{ el.confidence === 'high' ? '高' : el.confidence === 'medium' ? '中' : '低' }}
                              </el-tag>
                              <span class="element-type">{{ el.type }}</span>
                              <span class="element-desc">{{ el.description }}</span>
                            </div>
                            <div v-if="msg.resultData.elements.length > 10" class="more-elements">
                              还有 {{ msg.resultData.elements.length - 10 }} 个元素...
                            </div>
                          </div>
                        </div>

                        <!-- 房间列表 -->
                        <div v-if="msg.resultData.spaces && msg.resultData.spaces.length > 0" class="result-section">
                          <h4>🚪 识别区域 ({{ msg.resultData.spaces.length }})</h4>
                          <div class="spaces-list">
                            <div v-for="(space, idx) in msg.resultData.spaces" :key="idx" class="space-item">
                              <strong>{{ space.name }}</strong>
                              <span class="space-pos">{{ space.position }}</span>
                              <span class="space-area">{{ space.estimated_area }}</span>
                            </div>
                          </div>
                        </div>

                        <!-- 尺寸标注 -->
                        <div v-if="msg.resultData.dimensions && msg.resultData.dimensions.length > 0" class="result-section">
                          <h4>📐 尺寸标注 ({{ msg.resultData.dimensions.length }})</h4>
                          <div class="dimensions-list">
                            <div v-for="(dim, idx) in msg.resultData.dimensions.slice(0, 8)" :key="idx" class="dimension-item">
                              <span class="dim-value">{{ dim.value }}</span>
                              <span class="dim-target">{{ dim.target }}</span>
                            </div>
                          </div>
                        </div>

                        <!-- 质量报告 -->
                        <div v-if="msg.resultData._quality" class="result-section quality-section">
                          <h4>✨ 识别质量</h4>
                          <div class="quality-stats">
                            <div class="stat-item">
                              <span class="stat-label">Token 用量</span>
                              <span class="stat-value">{{ msg.resultData._meta?.totalTokens || 0 }}</span>
                            </div>
                            <div class="stat-item">
                              <span class="stat-label">OCR 覆盖率</span>
                              <span class="stat-value">{{ msg.resultData._quality.ocrCoverage }}</span>
                            </div>
                          </div>
                          <div v-if="msg.resultData._quality.issues && msg.resultData._quality.issues.length > 0" class="issues-list">
                            <div v-for="(issue, idx) in msg.resultData._quality.issues" :key="idx" class="issue-item">
                              ⚠ {{ issue }}
                            </div>
                          </div>
                        </div>

                        <!-- 摘要 -->
                        <div v-if="msg.resultData.summary" class="result-section">
                          <h4>📝 摘要</h4>
                          <p class="summary-text">{{ msg.resultData.summary }}</p>
                        </div>
                      </div>

                      <!-- 失败状态 -->
                      <div v-else-if="msg.status === 'FAILED'" class="error-state">
                        <el-icon color="#f56c6c"><Close /></el-icon>
                        <span class="error-text">{{ msg.error || '识别失败' }}</span>
                      </div>
                    </div>
                  </div>

                  <!-- 错误消息 -->
                  <div v-else-if="msg.type === 'error'" class="error-message">
                    <div class="message-content">
                      <p class="error-text">{{ msg.content }}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="input-area">
              <div v-if="previewUrls.length > 0" class="preview-section">
                <div class="preview-list">
                  <div
                    v-for="(url, index) in previewUrls"
                    :key="index"
                    class="preview-item"
                  >
                    <img :src="url" class="preview-image" />
                    <el-icon class="remove-icon" @click="removeFile(index)">
                      <CircleClose />
                    </el-icon>
                  </div>
                </div>
              </div>

              <div class="input-box">
                <el-input
                  v-model="message"
                  type="textarea"
                  :rows="2"
                  placeholder="添加备注说明（可选）..."
                  class="message-input"
                />
                <div class="input-actions">
                  <label class="upload-btn">
                    <el-icon><Upload /></el-icon>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      class="file-input"
                      @change="handleFileUpload"
                    />
                  </label>
                  <el-button
                    type="success"
                    circle
                    class="send-btn"
                    :disabled="uploadedFiles.length === 0 || isSending"
                    :loading="isSending"
                    @click="sendMessage"
                  >
                    <el-icon><Promotion /></el-icon>
                  </el-button>
                </div>
              </div>
            </div>
          </div>
        </el-main>
      </el-container>
    </el-container>
  </div>
</template>

<style scoped>
.workspace-container {
  min-height: 100vh;
  background: #f5f7fa;
  overflow-x: hidden;
}

.workspace-layout {
  height: 100vh;
}

.workspace-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #e4e7ed;
  background: #fff;
  height: 60px;
  padding: 0 20px;
}

.header-left .logo {
  font-size: 20px;
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

.workspace-content {
  height: calc(100vh - 60px);
}

.history-aside {
  background: #fff;
  border-right: 1px solid #e4e7ed;
  display: flex;
  flex-direction: column;
}

.history-header {
  padding: 16px 20px;
  font-size: 16px;
  font-weight: 600;
  color: #303133;
  border-bottom: 1px solid #e4e7ed;
}

.history-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.history-item {
  padding: 12px 16px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.2s;
  margin-bottom: 4px;
}

.history-item:hover {
  background: #f0f9ff;
}

.history-name {
  font-size: 14px;
  color: #303133;
  margin-bottom: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-status {
  margin-bottom: 4px;
}

.history-time {
  font-size: 12px;
  color: #909399;
}

.empty-history {
  text-align: center;
  padding: 40px 20px;
  color: #909399;
  font-size: 14px;
}

.chat-main {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
}

.chat-container {
  width: 100%;
  max-width: 900px;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.chat-area {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.welcome-message {
  text-align: center;
  color: #606266;
  padding: 80px 20px;
}

.welcome-icon {
  font-size: 64px;
  color: #22c55e;
  margin-bottom: 20px;
}

.welcome-message h2 {
  font-size: 28px;
  color: #22c55e;
  margin-bottom: 12px;
}

.welcome-message p {
  font-size: 16px;
  color: #909399;
  margin-bottom: 8px;
}

.welcome-message .tip {
  font-size: 14px;
  color: #c0c4cc;
}

.messages-list {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.message-item {
  display: flex;
  width: 100%;
}

.message-item.user {
  justify-content: flex-end;
}

.message-item.ai {
  justify-content: flex-start;
}

.user-message .message-content {
  background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
  color: #fff;
  padding: 16px 20px;
  border-radius: 16px 16px 4px 16px;
  max-width: 70%;
}

.ai-message {
  display: flex;
  gap: 12px;
  max-width: 90%;
}

.ai-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 600;
  flex-shrink: 0;
}

.ai-message .message-content {
  background: #fff;
  padding: 16px 20px;
  border-radius: 16px 16px 16px 4px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
  flex: 1;
}

.file-info {
  margin-top: 8px;
}

.file-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  opacity: 0.9;
}

.preview-image-small {
  width: 40px;
  height: 40px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.3);
}

.image-error {
  width: 40px;
  height: 40px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.1);
  border-radius: 4px;
  color: rgba(255, 255, 255, 0.6);
  font-size: 10px;
  gap: 2px;
}

.image-error .el-icon {
  font-size: 16px;
}

.loading-state {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: flex-start;
}

.loading-icon {
  color: #22c55e;
  font-size: 24px;
}

.status-text {
  color: #606266;
  font-size: 14px;
}

.progress-bar {
  width: 100%;
}

.result-content {
  color: #303133;
}

.result-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 600;
  color: #67c23a;
  margin-bottom: 16px;
}

.result-section {
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid #f0f0f0;
}

.result-section:last-child {
  border-bottom: none;
  margin-bottom: 0;
  padding-bottom: 0;
}

.result-section h4 {
  font-size: 14px;
  color: #303133;
  margin-bottom: 12px;
  font-weight: 600;
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 12px;
}

.info-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.info-item .label {
  font-size: 12px;
  color: #909399;
}

.info-item .value {
  font-size: 14px;
  color: #303133;
  font-weight: 500;
}

.elements-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.element-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.element-type {
  font-weight: 500;
  color: #409eff;
}

.element-desc {
  color: #606266;
  flex: 1;
}

.more-elements {
  font-size: 12px;
  color: #909399;
  text-align: center;
  padding-top: 4px;
}

.spaces-list {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.space-item {
  background: #f0f9ff;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.space-pos {
  color: #909399;
  font-size: 12px;
}

.space-area {
  color: #22c55e;
  font-size: 12px;
  font-weight: 500;
}

.dimensions-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.dimension-item {
  background: #f5f7fa;
  padding: 6px 10px;
  border-radius: 4px;
  font-size: 13px;
  display: flex;
  gap: 8px;
}

.dim-value {
  font-weight: 600;
  color: #e6a23c;
}

.dim-target {
  color: #606266;
}

.quality-stats {
  display: flex;
  gap: 24px;
  margin-bottom: 12px;
}

.stat-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stat-label {
  font-size: 12px;
  color: #909399;
}

.stat-value {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
}

.issues-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.issue-item {
  font-size: 12px;
  color: #e6a23c;
}

.summary-text {
  font-size: 14px;
  line-height: 1.6;
  color: #606266;
  margin: 0;
}

.error-state {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #f56c6c;
}

.error-state .error-text {
  color: #f56c6c;
}

.error-message .message-content {
  background: #fef0f0;
  color: #f56c6c;
  padding: 12px 16px;
  border-radius: 16px;
}

.error-text {
  color: #f56c6c;
  display: flex;
  align-items: center;
  gap: 6px;
}

.input-area {
  padding: 20px;
}

.preview-section {
  margin-bottom: 16px;
}

.preview-list {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.preview-item {
  position: relative;
  width: 80px;
  height: 80px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid #e4e7ed;
}

.preview-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.remove-icon {
  position: absolute;
  top: 2px;
  right: 2px;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  border-radius: 50%;
  font-size: 16px;
  cursor: pointer;
  padding: 2px;
}

.remove-icon:hover {
  background: rgba(0, 0, 0, 0.8);
}

.input-box {
  background: #fff;
  border-radius: 20px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.1);
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.message-input {
  border: none;
  resize: none;
}

.message-input :deep(.el-textarea__inner) {
  border: none;
  box-shadow: none;
  padding: 0;
  font-size: 15px;
}

.message-input :deep(.el-textarea__inner:focus) {
  outline: none;
}

.input-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 8px;
  border-top: 1px solid #f0f0f0;
}

.upload-btn {
  cursor: pointer;
  color: #909399;
  font-size: 20px;
  padding: 6px;
  border-radius: 6px;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.upload-btn:hover {
  background: #f0f9ff;
  color: #22c55e;
}

.file-input {
  display: none;
}

.send-btn {
  width: 40px;
  height: 40px;
  background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
  border: none;
}

.send-btn:disabled {
  background: #d1d5db;
  cursor: not-allowed;
}

.send-btn .el-icon {
  font-size: 18px;
}
</style>
