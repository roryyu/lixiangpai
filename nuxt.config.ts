// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: false },

  modules: [
    '@element-plus/nuxt',
    '@sidebase/nuxt-auth',
  ],

  elementPlus: {
    defaultLocale: 'zh-cn',
  },

  css: ['~/assets/css/main.css'],

  auth: {
    baseURL: process.env.AUTH_ORIGIN,
    provider: {
      type: 'local',
      token: {
        signInResponseTokenPointer: '/token',
        maxAgeInSeconds: 60 * 60 * 24, // 24 hours
      },
      endpoints: {
        signIn: { path: '/api/auth/login', method: 'post' },
        signOut: { path: '/api/auth/logout', method: 'post' },
        signUp: { path: '/api/auth/register', method: 'post' },
        getSession: { path: '/api/auth/me', method: 'get' },
      },
    },
    pages: {
      login: '/login',
    },
    session: {
      enableRefreshPeriodically: false,
      enableRefreshOnWindowFocus: true,
    },
  },

  runtimeConfig: {
    authSecret: process.env.AUTH_SECRET,
    databaseUrl: process.env.DATABASE_URL,
  },
})
