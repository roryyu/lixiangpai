import jwt from 'jsonwebtoken'
import bcryptjs from 'bcryptjs'

const SECRET = process.env.AUTH_SECRET
if (!SECRET) {
  throw new Error('AUTH_SECRET 环境变量未设置，请在 .env 中配置')
}

export function hashPassword(password: string): Promise<string> {
  return bcryptjs.hash(password, 12)
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcryptjs.compare(password, hash)
}

export function generateToken(payload: { userId: string; email: string }): string {
  return jwt.sign(payload, SECRET, { expiresIn: '24h' })
}

export function verifyToken(token: string): { userId: string; email: string } | null {
  try {
    return jwt.verify(token, SECRET) as { userId: string; email: string }
  }
  catch {
    return null
  }
}

export function getTokenFromHeader(event: any): string | null {
  const authHeader = getRequestHeader(event, 'authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  return authHeader.slice(7)
}

export function getTokenFromCookie(event: any): string | null {
  const cookies = parseCookies(event)
  // @sidebase/nuxt-auth default cookie names
  return cookies['auth.token'] || cookies['auth:token'] || cookies['nuxt-auth-token'] || cookies['nuxt-auth:session'] || null
}

export function getUserFromToken(event: any): { userId: string; email: string } | null {
  const token = getTokenFromHeader(event) || getTokenFromCookie(event)
  if (!token) return null
  return verifyToken(token)
}

export async function getAdminUser(event: any) {
  const payload = getUserFromToken(event)
  if (!payload) {
    throw createError({
      statusCode: 401,
      message: '未授权',
    })
  }

  const { prisma } = await import('./prisma')
  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
  })

  if (!user || user.role !== 'ADMIN') {
    throw createError({
      statusCode: 403,
      message: '无权限执行此操作',
    })
  }

  return user
}
