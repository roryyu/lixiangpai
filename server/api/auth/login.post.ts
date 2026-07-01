import { z } from 'zod'
import { prisma } from '../../utils/prisma'
import { verifyPassword, generateToken } from '../../utils/auth'

const loginSchema = z.object({
  email: z.string().email('邮箱格式不正确'),
  password: z.string().min(1, '请输入密码'),
})

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, loginSchema.parse)

  const user = await prisma.user.findUnique({
    where: { email: body.email },
  })

  if (!user) {
    throw createError({
      statusCode: 401,
      message: '邮箱或密码错误',
    })
  }

  const isValid = await verifyPassword(body.password, user.password)

  if (!isValid) {
    throw createError({
      statusCode: 401,
      message: '邮箱或密码错误',
    })
  }

  const token = generateToken({ userId: user.id, email: user.email })

  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      role: user.role,
    },
  }
})
