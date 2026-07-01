<script setup lang="ts">
import type { FormInstance, FormRules } from 'element-plus'

definePageMeta({
  layout: 'default',
  auth: {
    unauthenticatedOnly: true,
    navigateAuthenticatedTo: '/',
  },
})

const route = useRoute()
const router = useRouter()

const formRef = ref<FormInstance>()
const loading = ref(false)
const success = ref(false)
const token = computed(() => route.query.token as string)

const form = reactive({
  password: '',
  confirmPassword: '',
})

const rules: FormRules = {
  password: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 6, message: '密码至少6个字符', trigger: 'blur' },
  ],
  confirmPassword: [
    { required: true, message: '请确认密码', trigger: 'blur' },
    {
      validator: (_rule: any, value: string, callback: Function) => {
        if (value !== form.password) {
          callback(new Error('两次密码不一致'))
        }
        else {
          callback()
        }
      },
      trigger: 'blur',
    },
  ],
}

async function handleSubmit() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  loading.value = true
  try {
    await $fetch('/api/auth/reset-password', {
      method: 'POST',
      body: { token: token.value, password: form.password },
    })
    success.value = true
    ElMessage.success('密码重置成功')
    setTimeout(() => router.push('/login'), 2000)
  }
  catch (error: any) {
    ElMessage.error(error?.data?.message || '重置失败')
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
        <h2>重置密码</h2>
      </template>
      <template v-if="!token">
        <el-result icon="warning" title="无效链接" sub-title="缺少重置令牌，请重新申请密码重置。">
          <template #extra>
            <NuxtLink to="/forgot-password">
              <el-button type="primary">重新申请</el-button>
            </NuxtLink>
          </template>
        </el-result>
      </template>
      <template v-else-if="success">
        <el-result icon="success" title="密码重置成功" sub-title="正在跳转到登录页面..." />
      </template>
      <template v-else>
        <el-form ref="formRef" :model="form" :rules="rules" label-width="0" @submit.prevent="handleSubmit">
          <el-form-item prop="password">
            <el-input v-model="form.password" type="password" placeholder="新密码" size="large" show-password />
          </el-form-item>
          <el-form-item prop="confirmPassword">
            <el-input v-model="form.confirmPassword" type="password" placeholder="确认新密码" size="large" show-password />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" size="large" :loading="loading" style="width: 100%" @click="handleSubmit">
              重置密码
            </el-button>
          </el-form-item>
        </el-form>
      </template>
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
</style>
