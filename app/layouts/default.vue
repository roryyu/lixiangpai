<script setup lang="ts">
const { data, status, signOut } = useAuth()

const router = useRouter()

async function handleLogout() {
  await signOut()
  router.push('/login')
}
</script>

<template>
  <el-container class="layout-container">
    <el-header class="layout-header">
      <div class="header-left">
        <NuxtLink to="/" class="logo">
          理享派
        </NuxtLink>
      </div>
      <div class="header-right">
        <template v-if="status === 'authenticated'">
          <span class="user-name">{{ data?.user?.name || data?.user?.email }}</span>
          <el-button type="danger" plain size="small" @click="handleLogout">
            退出登录
          </el-button>
        </template>
        <template v-else>
          <NuxtLink to="/login">
            <el-button type="primary" plain size="small">
              登录
            </el-button>
          </NuxtLink>
        </template>
      </div>
    </el-header>
    <el-main class="layout-main">
      <slot />
    </el-main>
  </el-container>
</template>

<style scoped>
.layout-container {
  min-height: 100vh;
}

.layout-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #e4e7ed;
  background: #fff;
}

.logo {
  font-size: 18px;
  font-weight: 700;
  color: #1da14dff;
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

.layout-main {
  max-width: 1200px;
  margin: 0 auto;
  width: 100%;
  padding: 20px;
}
</style>
