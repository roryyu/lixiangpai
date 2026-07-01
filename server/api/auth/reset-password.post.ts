import { z } from 'zod'
import { prisma } from '../../utils/prisma'
import { hashPassword } from '../../utils/auth'

const resetPasswordSchema = z.object({
  token: z.string().min(1, '缺少重置令牌'),
  password: z.string().min(6, '密码至少6个字符'),
})

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, resetPasswordSchema.parse)

  const resetRecord = await prisma.passwordReset.findUnique({
    where: { token: body.token },
  })

  if (!resetRecord || resetRecord.used || resetRecord.expiresAt < new Date()) {
    throw createError({
      statusCode: 400,
      message: '重置链接无效或已过期',
    })
  }

  const hashedPassword = await hashPassword(body.password)

  await prisma.$transaction([
    prisma.user.update({
      where: { email: resetRecord.email },
      data: { password: hashedPassword },
    }),
    prisma.passwordReset.update({
      where: { id: resetRecord.id },
      data: { used: true },
    }),
  ])

  return { message: '密码重置成功，请使用新密码登录' }
})
