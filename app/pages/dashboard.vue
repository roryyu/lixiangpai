<script setup lang="ts">
definePageMeta({
  middleware: 'auth',
})

const { data, signOut } = useAuth()
const router = useRouter()

async function handleLogout() {
  await signOut({ redirect: false })
  router.push('/login')
}
</script>

<template>
  <div class="dashboard">
    <el-card>
      <template #header>
        <div class="card-header">
          <h2>欢迎回来</h2>
          <el-button type="danger" @click="handleLogout">退出登录</el-button>
        </div>
      </template>
      <el-descriptions :column="1" border>
        <el-descriptions-item label="邮箱">
          {{ data?.user?.email }}
        </el-descriptions-item>
        <el-descriptions-item label="姓名">
          {{ data?.user?.name || '未设置' }}
        </el-descriptions-item>
        <el-descriptions-item label="手机号">
          {{ data?.user?.phone || '未设置' }}
        </el-descriptions-item>
        <el-descriptions-item label="角色">
          {{ data?.user?.role }}
        </el-descriptions-item>
        <el-descriptions-item label="注册时间">
          {{ data?.user?.createdAt }}
        </el-descriptions-item>
      </el-descriptions>
    </el-card>
  </div>
</template>

<style scoped>
.dashboard {
  padding-top: 40px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

h2 {
  margin: 0;
}
</style>
