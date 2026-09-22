<script setup lang="ts">
import { Upload, CircleClose, Promotion, Picture, Check, Close, Delete, Setting, Box, Plus } from '@element-plus/icons-vue'
import { marked } from 'marked'
import { ref, watch, nextTick } from 'vue'
import type { CadModel } from '../../shared/types/cad'

definePageMeta({
  middleware: 'auth',
  layout: false,
})

const { data: authData, signOut } = useAuth()
const router = useRouter()
const workspaceSnapshot = useState<{ dataUrl: string; fileName: string } | null>(
  'cad-workspace-snapshot',
  () => null,
)

const histories = ref<any[]>([])
const message = ref('')
const uploadedFiles = ref<File[]>([])
const previewUrls = ref<string[]>([])
const currentTask = ref<any>(null)
const isPolling = ref(false)
const chatMessages = ref<any[]>([])
const isSending = ref(false)

interface CadPreviewResult {
  model: CadModel
  title: string
  summary: string
  prompt: string
}

interface CadSourceMessage {
  resultData: Record<string, unknown>
  cadPreview?: CadPreviewResult
}

const cadAnalysisFields = ['drawing_info', 'elements', 'spaces', 'dimensions', 'annotations', 'summary', 'suggestion'] as const
const cadDialogVisible = ref(false)
const cadSourceMessage = ref<CadSourceMessage | null>(null)
const cadPrompt = ref('')
const cadPromptExpanded = ref<string[]>([])
const cadModel = ref<CadModel | null>(null)
const cadTitle = ref('')
const cadSummary = ref('')
const cadError = ref('')
const isCadGenerating = ref(false)
const isCadExporting = ref(false)
let cadRequest: AbortController | null = null

function hasCadAnalysis(result: Record<string, unknown> | null | undefined) {
  return !!result && cadAnalysisFields.some((key) => {
    const value = result[key]
    if (Array.isArray(value)) return value.length > 0
    if (typeof value === 'string') return !!value.trim()
    return !!value && typeof value === 'object' && Object.keys(value).length > 0
  })
}

function openCadPreview(msg: CadSourceMessage) {
  if (!hasCadAnalysis(msg.resultData)) return
  cancelCadGeneration()
  cadSourceMessage.value = msg
  const cached = msg.cadPreview
  // 只传当前消息的分析数据；不包含图片地址、统计信息或其他轮次的结果。
  const analysis = Object.fromEntries(cadAnalysisFields.map(key => [key, msg.resultData[key]]))
  cadPrompt.value = cached?.prompt || [
    '请根据以下图纸分析结果生成带材质的 3D 模型。',
    '保留已识别的尺寸、空间布局和部件关系，结合修改建议呈现效果。',
    '缺失尺寸可合理估算，并在摘要中说明；不要把分析文字或尺寸标注建成实体。',
    JSON.stringify(analysis),
  ].join('\n')
  cadModel.value = cached?.model || null
  cadTitle.value = cached?.title || ''
  cadSummary.value = cached?.summary || ''
  cadError.value = ''
  cadPromptExpanded.value = []
  cadDialogVisible.value = true
  if (!cached) void generateCadPreview()
}

async function generateCadPreview() {
  const source = cadSourceMessage.value
  if (!source || isCadGenerating.value) return
  const text = cadPrompt.value.trim()
  // 与 /api/cad/generate 的文本上限一致，不静默截断尺寸和结构数据。
  if (!text) {
    cadError.value = '请输入分析内容'
    cadPromptExpanded.value = ['analysis']
    return
  }
  const controller = new AbortController()
  cadRequest = controller
  isCadGenerating.value = true
  cadError.value = ''
  try {
    const res = await $fetch<{ success: boolean; model: CadModel; title: string; summary: string; normalizedText?: string }>(
      '/api/cad/generate',
      { method: 'POST', body: { text, mode: 'generate', autoCompact: true }, signal: controller.signal, retry: 0 },
    )
    // 关闭弹窗或切换结果后，旧请求不得覆盖新的预览。
    if (cadRequest !== controller) return
    if (!res.success || !res.model) throw new Error('未返回有效的 3D 模型，请重试')
    cadModel.value = res.model
    cadTitle.value = res.title
    cadSummary.value = res.summary
    cadPrompt.value = res.normalizedText || text
    source.cadPreview = { model: res.model, title: res.title, summary: res.summary, prompt: cadPrompt.value }
  } catch (error: any) {
    if (cadRequest !== controller) return
    cadError.value = error?.data?.message || error?.message || '3D 效果图生成失败，请重试'
  } finally {
    if (cadRequest === controller) {
      cadRequest = null
      isCadGenerating.value = false
    }
  }
}

function cancelCadGeneration() {
  cadRequest?.abort()
  cadRequest = null
  isCadGenerating.value = false
}

function onCadViewerError(error: string) {
  ElMessage({ type: 'error', message: error, duration: 10_000, showClose: true })
}

function importPreviewSnapshot(dataUrl: string) {
  if (isCadExporting.value) return
  if (isSending.value || isPolling.value) {
    ElMessage.warning('请等待当前任务完成后再将截图添加到新对话')
    return
  }
  isCadExporting.value = true
  try {
    const name = (cadTitle.value || '3D模型').replace(/[\\/:*?"<>|]/g, '-').slice(0, 80)
    workspaceSnapshot.value = { dataUrl, fileName: `${name}-${Date.now()}.png` }
    cadDialogVisible.value = false
    importCadSnapshot()
  } finally {
    isCadExporting.value = false
  }
}

watch(cadDialogVisible, visible => {
  if (!visible) cancelCadGeneration()
}, { flush: 'sync' })

// 后续对话状态
const isFollowUp = ref(false)
const contextSummary = ref<string>('')
const previousResultImage = ref<{ bucket: string; ossKey: string } | null>(null)

// 自动滚动 markdown 内容到底部
async function scrollMarkdownToBottom() {
  // await nextTick()
  // const markdownElements = document.querySelectorAll('.markdown-content-preview')
  // markdownElements.forEach((el) => {
  //   const htmlEl = el as HTMLElement
  //   htmlEl.scrollTop = htmlEl.scrollHeight
  // })
}

// 监听消息内容变化，自动滚动到底部
watch(
  () => chatMessages.value.map((m) => m.message),
  () => {
    scrollMarkdownToBottom()
  },
  { deep: true }
)

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

function handleMenuCommand(command: string) {
  //if (command === 'prompt') {
    router.push('/'+command)
  //}
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
  const maxFiles=1;
  const remainingSlots = maxFiles - uploadedFiles.value.length
  const filesToAdd = Array.from(files).slice(0, remainingSlots)

  filesToAdd.forEach((file) => {
    uploadedFiles.value.push(file)
    const url = URL.createObjectURL(file)
    previewUrls.value.push(url)
  })

  // 清空 input value，允许下次选择相同文件
  input.value = ''
}

function removeFile(index: number) {
  const url = previewUrls.value[index]
  if (url) URL.revokeObjectURL(url)
  uploadedFiles.value.splice(index, 1)
  previewUrls.value.splice(index, 1)
}

function startNewChat() {
  isPolling.value = false
  currentTask.value = null
  chatMessages.value = []
  message.value = ''
  isFollowUp.value = false
  contextSummary.value = ''
  previousResultImage.value = null
  previewUrls.value.forEach(url => URL.revokeObjectURL(url))
  uploadedFiles.value = []
  previewUrls.value = []
}

function importCadSnapshot() {
  const snapshot = workspaceSnapshot.value
  if (!snapshot) return
  // 消费后立即清除，返回或刷新工作台不会重复导入。
  workspaceSnapshot.value = null
  try {
    const prefix = 'data:image/png;base64,'
    if (!snapshot.dataUrl.startsWith(prefix)) throw new Error('截图格式无效，请重新截图')
    const binary = atob(snapshot.dataUrl.slice(prefix.length))
    if (!binary.length || binary.length > 50 * 1024 * 1024) {
      throw new Error('截图为空或超过 50MB，请调整画布后重试')
    }
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
    const file = new File([bytes], snapshot.fileName, { type: 'image/png' })
    const url = URL.createObjectURL(file)
    startNewChat()
    uploadedFiles.value = [file]
    previewUrls.value = [url]
    ElMessage.success('截图已添加到新对话，可补充需求后发送')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '截图导入失败，请重新截图')
  }
}

// 轮询任务状态
async function pollTaskStatus(taskId: string) {
  isPolling.value = true
  let pollCount = 0
  const maxPolls = 300 // 最多轮询60次

  while (isPolling.value && pollCount < maxPolls) {
    try {
      const res = await $fetch(`/api/tasks/${taskId}`) as any
      currentTask.value = res.task

      // 更新消息状态
      const taskMsg = chatMessages.value.find((m: any) => m.taskId === taskId)
      if (taskMsg) {
        taskMsg.status = res.task.status
        taskMsg.progress = Math.round(pollCount/maxPolls*100)
        taskMsg.message = res.task.message

        // 滚动到底部
        scrollMarkdownToBottom()

        if (res.task.status === 'COMPLETED') {
          taskMsg.progress=100
          taskMsg.response = res.task.outputData
          taskMsg.resultData = res.task.outputData
          // 提取上下文信息，用于后续迭代对话
          if (res.task.outputData?.contextSummary) {
            contextSummary.value = res.task.outputData.contextSummary
            isFollowUp.value = true
            if (res.task.outputData.resultImageBucket && res.task.outputData.resultImageOssKey) {
              previousResultImage.value = {
                bucket: res.task.outputData.resultImageBucket,
                ossKey: res.task.outputData.resultImageOssKey,
              }
            }
          }
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
      console.log('轮询次数:', pollCount,'res.task',res.task.status)
    } catch (error) {
      console.error('轮询任务状态失败:', error)
    }

    pollCount++
    
    // 每2秒轮询一次
    await new Promise(resolve => setTimeout(resolve, 2000+pollCount*10)) // 每2秒轮询一次
  }

  isPolling.value = false
}

// 发送消息/开始识别任务
async function sendMessage() {
  // 后续对话模式：调用迭代接口
  if (isFollowUp.value && contextSummary.value && currentTask.value?.id) {
    await sendFollowUp()
    return
  }

  // 首次对话模式：需要上传图片
  const imageFile = uploadedFiles.value[0]
  if (!imageFile || isSending.value) {
    return
  }

  // 清空之前的对话内容
  chatMessages.value = []
  // 重置后续对话状态
  isFollowUp.value = false
  contextSummary.value = ''
  previousResultImage.value = null

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
    formData.append('image', imageFile)
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
      response: null as any,
      resultData: null as any,
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

// 后续对话：基于上下文迭代生成效果图（同步，无需轮询）
async function sendFollowUp() {
  if (!message.value?.trim() || isSending.value) return

  isSending.value = true

  try {
    // 添加用户消息
    const userMessage = {
      id: Date.now().toString(),
      type: 'user',
      content: message.value,
      files: [],
      timestamp: new Date(),
    }
    chatMessages.value.push(userMessage)

    const userMsg = message.value
    message.value = ''

    // 添加 AI 加载占位消息
    const aiMessage = {
      id: Date.now().toString() + '_ai',
      type: 'ai',
      taskId: currentTask.value?.id || '',
      status: 'RUNNING',
      progress: 50,
      message: '正在生成效果图，请稍候...',
      response: null as any,
      resultData: null as any,
      error: null,
      timestamp: new Date(),
    }
    chatMessages.value.push(aiMessage)

    // 调用迭代接口（同步等待结果）
    const iterateRes = await $fetch('/api/tasks/iterate', {
      method: 'POST',
      body: {
        taskId: currentTask.value?.id,
        userMessage: userMsg,
        contextSummary: contextSummary.value,
      },
    }) as any

    // 直接用返回结果更新 AI 消息（通过响应式数组访问，确保触发视图更新）
    const msgIndex = chatMessages.value.findIndex(m => m.id === aiMessage.id)
    if (msgIndex !== -1) {
      chatMessages.value[msgIndex] = {
        ...chatMessages.value[msgIndex],
        status: 'COMPLETED',
        progress: 100,
        message: '迭代效果图生成完成',
        response: {
          resultImage: iterateRes.resultImage,
          resultImageBucket: iterateRes.resultImageBucket,
          resultImageOssKey: iterateRes.resultImageOssKey,
        },
        resultData: {
          resultImage: iterateRes.resultImage,
          resultImageBucket: iterateRes.resultImageBucket,
          resultImageOssKey: iterateRes.resultImageOssKey,
        },
      }
    }

    // 更新上下文中最新的效果图信息和压缩后的上下文
    previousResultImage.value = {
      bucket: iterateRes.resultImageBucket,
      ossKey: iterateRes.resultImageOssKey,
    }
    if (iterateRes.contextSummary) {
      contextSummary.value = iterateRes.contextSummary
    }

    // 刷新历史记录
    await loadHistories()

  } catch (error: any) {
    console.error('迭代对话失败:', error)
    chatMessages.value.push({
      id: Date.now().toString() + '_error',
      type: 'error',
      content: error.message || '迭代对话失败，请重试',
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

// 渲染 Markdown
const renderMarkdown = (text: string | undefined) => {
  if (!text) return ''
  return marked(text, { breaks: true, gfm: true })
}

// 点击历史任务，加载任务详情
async function loadTaskDetail(taskId: string) {
  try {
    const res = await $fetch(`/api/tasks/${taskId}`) as any
    const task = res.task
    currentTask.value = task

    // 清空之前的对话
    chatMessages.value = []

    // 渲染用户消息：inputData 的 userRequirement 和 imageUrl
    const inputData = task.inputData || {}
    if(task.status === 'COMPLETED'){
          const ossItem =await $fetch(`/api/oss/presigned?bucket=${inputData.bucket}&osskey=${inputData.ossKey}`) as any
          const userMessage = {
            id: Date.now().toString() + '_user',
            type: 'user',
            content: inputData.userRequirement || task.name || '上传图片进行识别',
            files: ossItem.url ? [{
              name: '上传图片',
              size: 0,
              url: ossItem.url,
            }] : [],
            timestamp: task.createdAt,
          }
          chatMessages.value.push(userMessage)

          if(task.outputData?.resultImageBucket && task.outputData?.resultImageOssKey){
            const ossResultItem =await $fetch(`/api/oss/presigned?bucket=${task.outputData?.resultImageBucket}&osskey=${task.outputData?.resultImageOssKey}`) as any
            task.outputData.resultImage = ossResultItem.url
          }

              // 渲染 AI 回复：outputData
          const aiMessage = {
            id: Date.now().toString() + '_ai',
            type: 'ai',
            taskId: task.id,
            status: task.status,
            progress: task.status === 'COMPLETED' ? 100 : 0,
            message: task.message || '',
            response: task.outputData,
            resultData: task.outputData,
            error: task.errorMsg,
            timestamp: task.updatedAt,
          }
          chatMessages.value.push(aiMessage)

          // 渲染迭代历史
          const iterations = task.outputData?.iterations || []
          for (let i = 0; i < iterations.length; i++) {
            const iter = iterations[i]
            // 迭代用户消息
            chatMessages.value.push({
              id: Date.now().toString() + '_iter_user_' + i,
              type: 'user',
              content: iter.userMessage,
              files: [],
              timestamp: iter.createdAt,
            })
            // 迭代 AI 消息
            let iterImageUrl = iter.resultImage
            if (iter.resultImageBucket && iter.resultImageOssKey) {
              try {
                const ossIter = await $fetch(`/api/oss/presigned?bucket=${iter.resultImageBucket}&osskey=${iter.resultImageOssKey}`) as any
                iterImageUrl = ossIter.url
              } catch (e) {
                console.error('获取迭代图片失败:', e)
              }
            }
            chatMessages.value.push({
              id: Date.now().toString() + '_iter_ai_' + i,
              type: 'ai',
              taskId: task.id,
              status: 'COMPLETED',
              progress: 100,
              message: '迭代效果图生成完成',
              response: { resultImage: iterImageUrl },
              resultData: { resultImage: iterImageUrl },
              error: null,
              timestamp: iter.createdAt,
            })
          }

          // 恢复后续对话状态
          if (task.outputData?.contextSummary) {
            contextSummary.value = task.outputData.contextSummary
            isFollowUp.value = true
            if (task.outputData.resultImageBucket && task.outputData.resultImageOssKey) {
              previousResultImage.value = {
                bucket: task.outputData.resultImageBucket,
                ossKey: task.outputData.resultImageOssKey,
              }
            }
          } else {
            isFollowUp.value = false
            contextSummary.value = ''
            previousResultImage.value = null
          }
    }
    if(task.status === 'RUNNING'){
      //TODO
          // 添加用户消息（上传图片）
        const base64Result = await $fetch('/api/image/to-base64', {
          method: 'POST',
          body: { path: inputData.imagePath }
        }) as any
        const userMessage = {
          id: Date.now().toString(),
          type: 'user',
          content: inputData.userRequirement || '上传图片进行识别',
          files: [{base64:base64Result.base64}],
          timestamp: new Date(),
        }
        chatMessages.value.push(userMessage)
        // 清空输入
        message.value = ''
        uploadedFiles.value = []
        previewUrls.value.forEach(url => URL.revokeObjectURL(url))
        previewUrls.value = []
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
        const formData = new FormData()
        formData.append('continue', '1')
        formData.append('userRequirement', inputData.userRequirement)
        formData.append('taskid', task.id)
        formData.append('imagePath', inputData.imagePath)

        await $fetch('/api/tasks/start', {
          method: 'POST',
          body: formData,
        }) as any

        currentTask.value = task
        aiMessage.taskId = task.id
        aiMessage.status = task.status
        aiMessage.message = task.message

        // 开始轮询任务状态
        await pollTaskStatus(task.id)
        await loadHistories()
    }



  } catch (error) {
    console.error('加载任务详情失败:', error)
    ElMessage.error('加载任务详情失败')
  }
}

// 删除任务
async function deleteTask(taskId: string) {
  try {
    await ElMessageBox.confirm('确定要删除该任务吗？删除后无法恢复。', '删除确认', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    })

    await $fetch(`/api/tasks/${taskId}`, {
      method: 'DELETE',
    })

    ElMessage.success('删除成功')
    
    // 如果删除的是当前查看的任务，清空对话
    if (currentTask.value?.id === taskId) {
      chatMessages.value = []
      currentTask.value = null
    }

    // 刷新历史记录
    await loadHistories()
  } catch (error: any) {
    if (error !== 'cancel') {
      console.error('删除任务失败:', error)
      ElMessage.error('删除失败，请重试')
    }
  }
}

onMounted(() => {
  importCadSnapshot()
  loadHistories()
})

onBeforeUnmount(() => {
  cancelCadGeneration()
  isPolling.value = false
  previewUrls.value.forEach(url => URL.revokeObjectURL(url))
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
          <el-button text :icon="Box" @click="router.push('/cad')">文字建模</el-button>
          <el-dropdown v-if="authData?.user?.role === 'ADMIN'" @command="handleMenuCommand">
            <span class="admin-menu">
              <el-icon><Setting /></el-icon>
              管理
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="prompt">提示词管理</el-dropdown-item>
                <el-dropdown-item command="users">用户管理</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
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
            <el-button
              text
              type="success"
              size="small"
              :icon="Plus"
              :disabled="isSending || isPolling"
              @click="startNewChat"
            >新建对话</el-button>
          </div>
          <div class="history-list">
            <div
              v-for="item in histories"
              :key="item.id"
              :class="['history-item', { active: currentTask?.id === item.id }]"
              @click="loadTaskDetail(item.id)"
            >
              <div class="history-header-row">
                <div class="history-name">{{ item.name || '未命名对话' }}</div>
                <el-button
                  type="danger"
                  size="small"
                  circle
                  plain
                  class="delete-btn"
                  @click.stop="deleteTask(item.id)"
                >
                  <el-icon><Delete /></el-icon>
                </el-button>
              </div>
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
                            v-if="file.base64 || file.url"
                            :src="file.base64 || file.url"
                            class="preview-image-small"
                            fit="cover"
                            :preview-src-list="[file.base64 || file.url]"
                            :preview-teleported="true"
                          >
                            <template #error>
                              <div class="image-error">
                                <el-icon><Picture /></el-icon>
                                <span>加载失败</span>
                              </div>
                            </template>
                          </el-image>
                          <span>{{ file.name }}{{ file.size > 0 ? ' (' + formatFileSize(file.size) + ')' : '' }}</span>
                        </div>
                      </div>
                    </div>
                    <div class="clear"></div>
                  </div>

                  <!-- AI 消息 -->
                  <div v-else-if="msg.type === 'ai'" class="ai-message">
                    <div class="ai-avatar">AI</div>
                    <div class="message-content">
                      <!-- 加载中状态 -->
                      <div v-if="msg.status === 'PENDING' || msg.status === 'RUNNING'" class="loading-state">
                        <el-icon class="is-loading loading-icon"><Promotion /></el-icon>
                        <div
                          v-html="renderMarkdown(msg.message)"
                          class="markdown-content markdown-content-preview"
                        ></div>
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
                          <el-button
                            v-if="hasCadAnalysis(msg.resultData)"
                            type="success"
                            plain
                            size="small"
                            :icon="Box"
                            @click="openCadPreview(msg)"
                          >生成3D效果图</el-button>
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
                          <h4>📝 图纸分析</h4>
                          <div v-html="renderMarkdown(msg.resultData.summary)" class="markdown-content summary-text"></div>
                        </div>
                        <!-- 建议 -->
                        <div v-if="msg.resultData.suggestion" class="result-section">
                          <h4>💡 修改建议</h4>
                          <div v-html="renderMarkdown(msg.resultData.suggestion)" class="markdown-content summary-text"></div>
                        </div>
                        <div v-if="msg.resultData.resultImage" class="result-section">
                          <h4>🖼️ 效果图</h4>
                          <div>
                            <img :src="msg.resultData.resultImage" alt="识别结果" class="result-image" />
                          </div>
                        </div>
                      </div>

                      <!-- 失败状态 -->
                      <div v-else-if="msg.status === 'FAILED'" class="error-state">
                        <el-icon color="#f56c6c"><Close /></el-icon>
                        <span class="error-text">{{ msg.error || '识别失败' }}</span>
                      </div>
                    </div>
                    <div class="clear"></div>
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
                  :placeholder="isFollowUp ? '描述你的修改需求，例如：把挂衣区改为叠放区、增加抽屉...' : '上传CAD图片并描述你的需求'"
                  class="message-input"
                />
                <div class="input-actions">
                  <label v-if="!isFollowUp" class="upload-btn">
                    <el-icon><Upload /></el-icon>
                    <input
                      type="file"
                      accept="image/*"
                      class="file-input"
                      @change="handleFileUpload"
                    />
                  </label>
                  <span v-else class="follow-up-hint">基于当前设计迭代</span>
                  <el-button
                    type="success"
                    class="send-btn"
                    :disabled="isFollowUp ? !(message && message.trim()) || isSending : uploadedFiles.length === 0 || isSending"
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

    <el-dialog
      v-model="cadDialogVisible"
      :title="cadTitle ? `3D效果图 · ${cadTitle}` : '生成3D效果图'"
      width="min(1100px, 94vw)"
      top="5vh"
      append-to-body
      destroy-on-close
      :close-on-click-modal="false"
    >
      <div class="cad-dialog-content">
        <el-collapse v-model="cadPromptExpanded">
          <el-collapse-item name="analysis" title="查看 / 调整分析内容">
            <el-input
              v-model="cadPrompt"
              type="textarea"
              :rows="5"
              resize="vertical"
              :disabled="isCadGenerating"
              aria-label="3D 建模分析内容"
            />
            <div class="cad-dialog-hint">{{ cadPrompt.length }} 字，超过 12000 字将自动调用大模型精简后生成，无需手动删减。</div>
          </el-collapse-item>
        </el-collapse>
        <el-alert v-if="cadError" :title="cadError" type="error" :closable="false" show-icon />
        <div
          v-loading="isCadGenerating"
          :element-loading-text="cadPrompt.trim().length > 12000 ? '分析内容较长，正在自动精简并生成 3D 效果图…' : '正在根据分析结果生成几何与材质方案…'"
          class="cad-dialog-canvas"
        >
          <CadViewer3D
            v-if="cadDialogVisible && cadModel"
            :model="cadModel"
            :exporting="isCadExporting || isCadGenerating"
            @snapshot="importPreviewSnapshot"
            @error="onCadViewerError"
          />
          <div v-else class="cad-dialog-placeholder">
            <el-icon><Box /></el-icon>
            <span>{{ cadError ? '生成失败，请点击下方按钮重试' : '3D 效果图将在这里显示' }}</span>
          </div>
        </div>
        <p v-if="cadSummary" class="cad-dialog-summary">{{ cadSummary }}</p>
        <div class="cad-dialog-hint">拖拽旋转、滚轮缩放；支持保存 DXF 或截图到工作台新对话。</div>
      </div>
      <template #footer>
        <el-button @click="cadDialogVisible = false">关闭</el-button>
        <el-button type="success" :loading="isCadGenerating" @click="generateCadPreview">
          {{ isCadGenerating ? '生成中…' : cadModel ? '重新生成' : '重试生成' }}
        </el-button>
      </template>
    </el-dialog>
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

.admin-menu {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  color: #606266;
  font-size: 14px;
  padding: 4px 8px;
  border-radius: 4px;
  transition: all 0.2s;
}

.admin-menu:hover {
  background: #f0f9ff;
  color: #22c55e;
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
  display: flex;
  align-items: center;
  justify-content: space-between;
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

.history-item.active {
  background: #e6f7ff;
  border: 1px solid #91d5ff;
}

.history-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.history-name {
  font-size: 14px;
  color: #303133;
  margin-bottom: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.delete-btn {
  opacity: 0;
  transition: opacity 0.2s;
  padding: 4px;
  width: 24px;
  height: 24px;
}

.history-item:hover .delete-btn {
  opacity: 1;
}

.delete-btn:hover {
  background: #fef0f0;
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

}

.message-item {
  width: 100%;
}

.message-item.user {
  padding-bottom: 20px;
}

.message-item.ai {
  padding-bottom: 20px;
}

.user-message {
  
}

.user-message .message-content {
  float:right;
  background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
  color: #fff;
  padding: 16px 20px;
  border-radius: 16px 16px 4px 16px;
  max-width: 70%;
  text-align: left;
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

.cad-dialog-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 72vh;
  overflow-y: auto;
}

.cad-dialog-canvas {
  position: relative;
  height: 50vh;
  min-height: 300px;
  flex-shrink: 0;
  border: 1px solid var(--el-border-color-light);
  border-radius: 12px;
  overflow: hidden;
  background: var(--el-fill-color-light);
}

.cad-dialog-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--el-text-color-secondary);
}

.cad-dialog-placeholder .el-icon {
  font-size: 48px;
}

.cad-dialog-summary {
  margin: 0;
  line-height: 1.6;
  white-space: pre-wrap;
  color: var(--el-text-color-regular);
}

.cad-dialog-hint {
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-text-color-secondary);
}

.result-header {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
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

.follow-up-hint {
  font-size: 12px;
  color: #22c55e;
  background: #f0f9ff;
  padding: 4px 10px;
  border-radius: 12px;
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

/* Markdown 样式 */
:deep(.markdown-content) {
  line-height: 1.6;
  color: #303133;
}

:deep(.markdown-content h1),
:deep(.markdown-content h2),
:deep(.markdown-content h3),
:deep(.markdown-content h4),
:deep(.markdown-content h5),
:deep(.markdown-content h6) {
  margin: 16px 0 8px 0;
  font-weight: 600;
  line-height: 1.4;
}

:deep(.markdown-content h1) {
  font-size: 24px;
  border-bottom: 1px solid #e4e7ed;
  padding-bottom: 8px;
}

:deep(.markdown-content h2) {
  font-size: 20px;
  border-bottom: 1px solid #e4e7ed;
  padding-bottom: 6px;
}

:deep(.markdown-content h3) {
  font-size: 18px;
}

:deep(.markdown-content h4) {
  font-size: 16px;
}

:deep(.markdown-content p) {
  margin: 8px 0;
}

:deep(.markdown-content ul),
:deep(.markdown-content ol) {
  margin: 8px 0;
  padding-left: 24px;
}

:deep(.markdown-content li) {
  margin: 4px 0;
}

:deep(.markdown-content code) {
  background: #f5f7fa;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 13px;
  font-family: 'Monaco', 'Menlo', monospace;
  color: #e6a23c;
}

:deep(.markdown-content pre) {
  background: #1e1e1e;
  color: #d4d4d4;
  padding: 12px 16px;
  border-radius: 6px;
  overflow-x: auto;
  margin: 12px 0;
}

:deep(.markdown-content pre code) {
  background: transparent;
  padding: 0;
  color: inherit;
}

:deep(.markdown-content blockquote) {
  border-left: 4px solid #22c55e;
  padding-left: 12px;
  margin: 12px 0;
  color: #606266;
  background: #f0f9ff;
  padding: 8px 12px;
  border-radius: 0 4px 4px 0;
}

:deep(.markdown-content a) {
  color: #409eff;
  text-decoration: none;
}

:deep(.markdown-content a:hover) {
  text-decoration: underline;
}

:deep(.markdown-content table) {
  border-collapse: collapse;
  width: 100%;
  margin: 12px 0;
}

:deep(.markdown-content th),
:deep(.markdown-content td) {
  border: 1px solid #e4e7ed;
  padding: 8px 12px;
  text-align: left;
}

:deep(.markdown-content th) {
  background: #f5f7fa;
  font-weight: 600;
}

:deep(.markdown-content hr) {
  border: none;
  border-top: 1px solid #e4e7ed;
  margin: 16px 0;
}

:deep(.markdown-content img) {
  max-width: 100%;
  border-radius: 4px;
}
.clear{
  clear: both;
}
.markdown-content-preview *{
  font-size: 12px;
  line-height: 1.2;
  color: #3c3d3e;
}
.result-image{
  display: block;
  margin: 0 auto;
  width: 90%;
}
</style>
