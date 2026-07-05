import { z } from 'zod'
import { prisma } from '../../utils/prisma'
import { getAdminUser, hashPassword } from '../../utils/auth'

const updateUserSchema = z.object({
  email: z.string().email('邮箱格式不正确').optional(),
  password: z.string().min(6, '密码至少6位').optional(),
  name: z.string().optional(),
  phone: z.string().optional().nullable(),
  role: z.enum(['USER', 'ADMIN']).optional(),
})

export default defineEventHandler(async (event) => {
  await getAdminUser(event)

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({
      statusCode: 400,
      message: '用户ID不能为空',
    })
  }

  const body = await readValidatedBody(event, updateUserSchema.parse)

  const existingUser = await prisma.user.findUnique({
    where: { id },
  })

  if (!existingUser) {
    throw createError({
      statusCode: 404,
      message: '用户不存在',
    })
  }

  if (body.email && body.email !== existingUser.email) {
    const duplicateEmail = await prisma.user.findUnique({
      where: { email: body.email },
    })
    if (duplicateEmail) {
      throw createError({
        statusCode: 400,
        message: '邮箱已存在',
      })
    }
  }

  if (body.phone && body.phone !== existingUser.phone) {
    const duplicatePhone = await prisma.user.findUnique({
      where: { phone: body.phone },
    })
    if (duplicatePhone) {
      throw createError({
        statusCode: 400,
        message: '手机号已存在',
      })
    }
  }

  const updateData: any = {}
  if (body.email) updateData.email = body.email
  if (body.password) updateData.password = await hashPassword(body.password)
  if (body.name !== undefined) updateData.name = body.name
  if (body.phone !== undefined) updateData.phone = body.phone
  if (body.role) updateData.role = body.role

  const user = await prisma.user.update({
    where: { id },
    data: updateData,
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
