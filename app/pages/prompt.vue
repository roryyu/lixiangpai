<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'

definePageMeta({
  middleware: 'auth',
})

const { data: session, getSession } = useAuth()

interface PromptSetting {
  id: string
  module?: string
  prompt?: string
  info?: string
  createdAt: string
  updatedAt: string
}

const prompts = ref<PromptSetting[]>([])
const loading = ref(false)
const dialogVisible = ref(false)
const dialogTitle = ref('新增 Prompt')
const currentId = ref('')
const formData = ref({
  module: '',
  prompt: '',
  info: '',
})

const getToken = () => {
  // @sidebase/nuxt-auth stores token in different places
  const data = session.value as any
  return data?.token || data?.accessToken || data?.rawToken || ''
}

const getAuthHeaders = () => {
  const token = getToken()
  return {
    Authorization: token ? `Bearer ${token}` : '',
  }
}

// Markdown 渲染函数
const renderMarkdown = (text: string) => {
  if (!text) return ''
  let html = text
    // 标题
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    // 粗体
    .replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>')
    // 斜体
    .replace(/\*(.*)\*/gim, '<em>$1</em>')
    // 代码行
    .replace(/`(.*?)`/gim, '<code>$1</code>')
    // 链接
    .replace(/\[([^\]]*)\]\(([^)]*)\)/gim, '<a href="$2" target="_blank">$1</a>')
    // 换行
    .replace(/\n/gim, '<br>')
  return html
}

const promptHtml = computed(() => renderMarkdown(formData.value.prompt || ''))

const fetchPrompts = async () => {
  loading.value = true
  try {
    const res = await $fetch('/api/prompts', {
      headers: getAuthHeaders(),
      credentials: 'include',
    })
    prompts.value = res.prompts || []
  } catch (error: any) {
    ElMessage.error(error.message || '获取数据失败')
  } finally {
    loading.value = false
  }
}

const handleAdd = () => {
  dialogTitle.value = '新增 Prompt'
  currentId.value = ''
  formData.value = {
    module: '',
    prompt: '',
    info: '',
  }
  dialogVisible.value = true
}

const handleEdit = (row: PromptSetting) => {
  dialogTitle.value = '编辑 Prompt'
  currentId.value = row.id
  formData.value = {
    module: row.module || '',
    prompt: row.prompt || '',
    info: row.info || '',
  }
  dialogVisible.value = true
}

const handleDelete = async (id: string) => {
  try {
    await $fetch(`/api/prompts/${id}`, { 
      method: 'DELETE',
      headers: getAuthHeaders(),
      credentials: 'include',
    })
    ElMessage.success('删除成功')
    fetchPrompts()
  } catch (error: any) {
    ElMessage.error(error.message || '删除失败')
  }
}

const handleSubmit = async () => {
  try {
    if (currentId.value) {
      await $fetch(`/api/prompts/${currentId.value}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        credentials: 'include',
        body: formData.value,
      })
      ElMessage.success('更新成功')
    } else {
      await $fetch('/api/prompts', {
        method: 'POST',
        headers: getAuthHeaders(),
        credentials: 'include',
        body: formData.value,
      })
      ElMessage.success('创建成功')
    }
    dialogVisible.value = false
    fetchPrompts()
  } catch (error: any) {
    ElMessage.error(error.message || '操作失败')
  }
}

onMounted(() => {
  fetchPrompts()
})
</script>

<template>
  <div class="prompt-page">
    <div class="header">
      <h2>Prompt 管理</h2>
      <el-button type="primary" @click="handleAdd">新增 Prompt</el-button>
    </div>

    <el-table :data="prompts" v-loading="loading" stripe style="width: 100%">
      <el-table-column prop="module" label="模块" width="200" />
      <el-table-column prop="info" label="说明" width="200" />
      <el-table-column prop="createdAt" label="创建时间" width="180">
        <template #default="{ row }">
          {{ new Date(row.createdAt).toLocaleString() }}
        </template>
      </el-table-column>
      <el-table-column label="操作" width="150" fixed="right">
        <template #default="{ row }">
          <el-button size="small" @click="handleEdit(row)">编辑</el-button>
          <el-button
            size="small"
            type="danger"
            @click="
              ElMessageBox.confirm('确定要删除吗？', '提示', {
                confirmButtonText: '确定',
                cancelButtonText: '取消',
                type: 'warning',
              }).then(() => handleDelete(row.id))
            "
          >
            删除
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog
      v-model="dialogVisible"
      :title="dialogTitle"
      width="900px"
      :close-on-click-modal="false"
    >
      <el-form :model="formData" label-width="80px">
        <el-form-item label="模块">
          <el-input v-model="formData.module" placeholder="请输入模块名称" />
        </el-form-item>
        <el-form-item label="说明">
          <el-input
            v-model="formData.info"
            type="textarea"
            :rows="3"
            placeholder="请输入说明信息"
          />
        </el-form-item>
        <el-form-item label="提示词">
          <el-input
            v-model="formData.prompt"
            type="textarea"
            :rows="10"
            placeholder="请输入提示词，支持 Markdown 语法"
          />
        </el-form-item>
        <el-form-item label="预览">
          <div class="markdown-preview dialog-preview" v-html="promptHtml"></div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSubmit">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.prompt-page {
  padding: 20px;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
}

.header h2 {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
}

.markdown-preview {
  font-size: 14px;
  line-height: 1.6;
  color: #333;
  max-height: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.markdown-preview h1 {
  font-size: 20px;
  font-weight: 600;
  margin: 8px 0;
}

.markdown-preview h2 {
  font-size: 18px;
  font-weight: 600;
  margin: 6px 0;
}

.markdown-preview h3 {
  font-size: 16px;
  font-weight: 600;
  margin: 4px 0;
}

.markdown-preview strong {
  font-weight: 600;
}

.markdown-preview em {
  font-style: italic;
}

.markdown-preview code {
  background: #f5f5f5;
  padding: 2px 6px;
  border-radius: 4px;
  font-family: monospace;
  font-size: 12px;
}

.markdown-preview a {
  color: #409eff;
  text-decoration: underline;
}

.dialog-preview {
  max-height: 300px;
  overflow-y: auto;
  padding: 16px;
  background: #fafafa;
  border-radius: 8px;
  border: 1px solid #eaeaea;
}
</style>
