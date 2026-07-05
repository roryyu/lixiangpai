import { z } from 'zod'
import { prisma } from '../../utils/prisma'
import { getAdminUser, hashPassword } from '../../utils/auth'

const createUserSchema = z.object({
  email: z.string().email('邮箱格式不正确'),
  password: z.string().min(6, '密码至少6位'),
  name: z.string().optional(),
  phone: z.string().optional(),
  role: z.enum(['USER', 'ADMIN']).default('USER'),
})

export default defineEventHandler(async (event) => {
  await getAdminUser(event)

  const body = await readValidatedBody(event, createUserSchema.parse)

  const existingUser = await prisma.user.findUnique({
    where: { email: body.email },
  })

  if (existingUser) {
    throw createError({
      statusCode: 400,
      message: '邮箱已存在',
    })
  }

  if (body.phone) {
    const existingPhone = await prisma.user.findUnique({
      where: { phone: body.phone },
    })
    if (existingPhone) {
      throw createError({
        statusCode: 400,
        message: '手机号已存在',
      })
    }
  }

  const hashedPassword = await hashPassword(body.password)

  const user = await prisma.user.create({
    data: {
      email: body.email,
      password: hashedPassword,
      name: body.name,
      phone: body.phone,
      role: body.role,
    },
    select: {
      id: true,
      email: true,
      name: true,
      phone: true,
      role: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  return { user }
})
