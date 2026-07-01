import jwt from 'jsonwebtoken'
import bcryptjs from 'bcryptjs'

const SECRET = process.env.AUTH_SECRET || 'fallback-secret'

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
