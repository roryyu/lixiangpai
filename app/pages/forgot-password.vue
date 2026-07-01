<script setup lang="ts">
import type { FormInstance, FormRules } from 'element-plus'

definePageMeta({
  layout: 'default',
  auth: {
    unauthenticatedOnly: true,
    navigateAuthenticatedTo: '/',
  },
})

const formRef = ref<FormInstance>()
const loading = ref(false)
const submitted = ref(false)
const form = reactive({
  email: '',
})

const rules: FormRules = {
  email: [
    { required: true, message: '请输入邮箱', trigger: 'blur' },
    { type: 'email', message: '邮箱格式不正确', trigger: 'blur' },
  ],
}

async function handleSubmit() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  loading.value = true
  try {
    await $fetch('/api/auth/forgot-password', {
      method: 'POST',
      body: { email: form.email },
    })
    submitted.value = true
  }
  catch (error: any) {
    ElMessage.error(error?.data?.message || '请求失败')
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="auth-page">
    <el-card class="auth-card">
      <template #header>
        <h2>忘记密码</h2>
      </template>
      <template v-if="!submitted">
        <p class="tip">请输入您的注册邮箱，我们将发送密码重置链接。</p>
        <el-form ref="formRef" :model="form" :rules="rules" label-width="0" @submit.prevent="handleSubmit">
          <el-form-item prop="email">
            <el-input v-model="form.email" placeholder="邮箱" size="large" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" size="large" :loading="loading" style="width: 100%" @click="handleSubmit">
              发送重置链接
            </el-button>
          </el-form-item>
        </el-form>
      </template>
      <template v-else>
        <el-result icon="success" title="邮件已发送" sub-title="请查看您的邮箱，点击重置链接修改密码。" />
      </template>
      <div class="auth-links">
        <NuxtLink to="/login">返回登录</NuxtLink>
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.auth-page {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 80vh;
}

.auth-card {
  width: 400px;
}

h2 {
  margin: 0;
  text-align: center;
}

.tip {
  color: #909399;
  font-size: 14px;
  margin-bottom: 20px;
  text-align: center;
}

.auth-links {
  text-align: center;
  font-size: 14px;
}

.auth-links a {
  color: #409eff;
  text-decoration: none;
}

.auth-links a:hover {
  text-decoration: underline;
}
</style>
