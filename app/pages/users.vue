<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'

definePageMeta({
  middleware: 'auth',
})

const { data: session } = useAuth()

interface User {
  id: string
  email: string
  name?: string
  phone?: string
  role: string
  createdAt: string
  updatedAt: string
}

const users = ref<User[]>([])
const loading = ref(false)
const dialogVisible = ref(false)
const dialogTitle = ref('新增用户')
const currentId = ref('')
const formData = ref({
  email: '',
  password: '',
  name: '',
  phone: '',
  role: 'USER',
})

const isAdmin = computed(() => {
  const data = session.value as any
  return data?.user?.role === 'ADMIN'
})

const getToken = () => {
  const data = session.value as any
  return data?.token || data?.accessToken || data?.rawToken || ''
}

const getAuthHeaders = () => {
  const token = getToken()
  return {
    Authorization: token ? `Bearer ${token}` : '',
  }
}

const fetchUsers = async () => {
  if (!isAdmin.value) return
  
  loading.value = true
  try {
    const res = await $fetch('/api/users', {
      headers: getAuthHeaders(),
      credentials: 'include',
    })
    users.value = res.users || []
  } catch (error: any) {
    ElMessage.error(error.message || '获取数据失败')
  } finally {
    loading.value = false
  }
}

const handleAdd = () => {
  dialogTitle.value = '新增用户'
  currentId.value = ''
  formData.value = {
    email: '',
    password: '',
    name: '',
    phone: '',
    role: 'USER',
  }
  dialogVisible.value = true
}

const handleEdit = (row: User) => {
  dialogTitle.value = '编辑用户'
  currentId.value = row.id
  formData.value = {
    email: row.email,
    password: '',
    name: row.name || '',
    phone: row.phone || '',
    role: row.role,
  }
  dialogVisible.value = true
}

const handleDelete = async (id: string) => {
  try {
    await $fetch(`/api/users/${id}`, { 
      method: 'DELETE',
      headers: getAuthHeaders(),
      credentials: 'include',
    })
    ElMessage.success('删除成功')
    fetchUsers()
  } catch (error: any) {
    ElMessage.error(error.message || '删除失败')
  }
}

const handleSubmit = async () => {
  if (!formData.value.email) {
    ElMessage.error('请输入邮箱')
    return
  }
  
  if (!currentId.value && !formData.value.password) {
    ElMessage.error('请输入密码')
    return
  }

  try {
    if (currentId.value) {
      const updateData: any = {
        email: formData.value.email,
        name: formData.value.name,
        phone: formData.value.phone || null,
        role: formData.value.role,
      }
      if (formData.value.password) {
        updateData.password = formData.value.password
      }
      
      await $fetch(`/api/users/${currentId.value}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        credentials: 'include',
        body: updateData,
      })
      ElMessage.success('更新成功')
    } else {
      await $fetch('/api/users', {
        method: 'POST',
        headers: getAuthHeaders(),
        credentials: 'include',
        body: formData.value,
      })
      ElMessage.success('创建成功')
    }
    dialogVisible.value = false
    fetchUsers()
  } catch (error: any) {
    ElMessage.error(error.message || '操作失败')
  }
}

onMounted(() => {
  if (isAdmin.value) {
    fetchUsers()
  }
})
</script>

<template>
  <div class="users-page">
    <div v-if="!isAdmin" class="no-permission">
      <el-empty description="无权限访问此页面" />
    </div>

    <div v-else>
      <div class="header">
        <h2>用户管理</h2>
        <el-button type="primary" @click="handleAdd">新增用户</el-button>
      </div>

      <el-table :data="users" v-loading="loading" stripe style="width: 100%">
        <el-table-column prop="email" label="邮箱" min-width="200" />
        <el-table-column prop="name" label="姓名" width="120" />
        <el-table-column prop="phone" label="手机号" width="140" />
        <el-table-column prop="role" label="角色" width="100">
          <template #default="{ row }">
            <el-tag :type="row.role === 'ADMIN' ? 'danger' : 'info'">
              {{ row.role === 'ADMIN' ? '管理员' : '普通用户' }}
            </el-tag>
          </template>
        </el-table-column>
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
                ElMessageBox.confirm('确定要删除该用户吗？', '提示', {
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
        width="500px"
        :close-on-click-modal="false"
      >
        <el-form :model="formData" label-width="80px">
          <el-form-item label="邮箱" required>
            <el-input v-model="formData.email" placeholder="请输入邮箱" />
          </el-form-item>
          <el-form-item :label="currentId ? '新密码' : '密码'">
            <el-input
              v-model="formData.password"
              type="password"
              :placeholder="currentId ? '不修改请留空' : '请输入密码'"
            />
          </el-form-item>
          <el-form-item label="姓名">
            <el-input v-model="formData.name" placeholder="请输入姓名" />
          </el-form-item>
          <el-form-item label="手机号">
            <el-input v-model="formData.phone" placeholder="请输入手机号" />
          </el-form-item>
          <el-form-item label="角色">
            <el-select v-model="formData.role" style="width: 100%">
              <el-option label="普通用户" value="USER" />
              <el-option label="管理员" value="ADMIN" />
            </el-select>
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="dialogVisible = false">取消</el-button>
          <el-button type="primary" @click="handleSubmit">确定</el-button>
        </template>
      </el-dialog>
    </div>
  </div>
</template>

<style scoped>
.users-page {
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

.no-permission {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 400px;
}
</style>
